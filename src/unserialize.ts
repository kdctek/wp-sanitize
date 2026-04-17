import { PhpSerializeError, type PhpKey, type PhpValue } from './types.ts';

export type Encoding = 'utf8' | 'latin1' | 'auto';

export interface UnserializeOptions {
  // 'utf8'   — strict: byte counts are UTF-8 byte lengths (WordPress default).
  // 'latin1' — each JS char is treated as 1 byte (for latin1_* MySQL collations).
  // 'auto'   — try utf8 first, fall back to latin1 per-string with a warning.
  encoding?: Encoding;
  // Populated by the parser with non-fatal messages (e.g. mojibake recovery).
  warnings?: string[];
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

// The Cursor tracks two parallel positions: bytePos (into the UTF-8 byte
// array) and charPos (into the original JS string, in UTF-16 code units).
// All control-path bytes in PHP serialized data are ASCII, so byte and char
// positions advance in lockstep everywhere except inside string content.
// There we first attempt to read N bytes (what PHP actually wrote); if that
// doesn't land on the expected closing `";`, we fall back to reading N chars
// (which handles mojibake cases like Latin-1-interpreted UTF-8).
class Cursor {
  readonly bytes: Uint8Array;
  readonly chars: string;
  bytePos = 0;
  charPos = 0;
  readonly warnings: string[];
  readonly encoding: Encoding;

  constructor(input: string, encoding: Encoding, warnings: string[]) {
    this.chars = input;
    this.bytes = new TextEncoder().encode(input);
    this.warnings = warnings;
    this.encoding = encoding;
  }

  eof(): boolean {
    return this.bytePos >= this.bytes.length;
  }

  peekByte(): number | undefined {
    return this.bytes[this.bytePos];
  }

  skipWhitespace(): void {
    while (!this.eof()) {
      const b = this.bytes[this.bytePos];
      if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
        this.bytePos++;
        this.charPos++;
        continue;
      }
      break;
    }
  }

  // Consume one ASCII byte, advancing both positions. Throws on EOF or non-ASCII.
  takeAscii(): number {
    const b = this.bytes[this.bytePos];
    if (b === undefined) throw new PhpSerializeError('unexpected end of input', this.bytePos);
    if (b > 0x7f) {
      throw new PhpSerializeError(
        `unexpected non-ASCII byte 0x${b.toString(16)} in control position`,
        this.bytePos,
      );
    }
    this.bytePos++;
    this.charPos++;
    return b;
  }

  expect(ch: string): void {
    const want = ch.charCodeAt(0);
    const got = this.takeAscii();
    if (got !== want) {
      throw new PhpSerializeError(
        `expected '${ch}' but got '${String.fromCharCode(got)}'`,
        this.bytePos - 1,
      );
    }
  }

  // Read ASCII bytes until `ch`, advancing both positions. Throws on non-ASCII.
  readAsciiUntil(ch: string): string {
    const want = ch.charCodeAt(0);
    const start = this.bytePos;
    while (!this.eof()) {
      const b = this.bytes[this.bytePos];
      if (b === want) break;
      if (b !== undefined && b > 0x7f) {
        throw new PhpSerializeError(
          `unexpected non-ASCII byte 0x${b.toString(16)} while scanning for '${ch}'`,
          this.bytePos,
        );
      }
      this.bytePos++;
      this.charPos++;
    }
    if (this.eof()) throw new PhpSerializeError(`expected '${ch}'`, this.bytePos);
    const slice = this.bytes.subarray(start, this.bytePos);
    return new TextDecoder('utf-8', { fatal: false }).decode(slice);
  }

  // Read a string's content of claimed length `n`. The caller tells us which
  // char follows the closing `"` (`;` for string values/keys, `:` for object
  // class names) so we can disambiguate in char-mode fallback — string
  // contents can legally contain `"`, so we need a two-char boundary check.
  //
  // Byte mode is tried first (strict PHP behaviour). If the byte count would
  // land on a `"` followed by the expected char, we consume those bytes.
  // Otherwise we fall back to treating the claimed count as a character count
  // in the JS input string — this recovers data that was mojibake-encoded
  // (e.g., Latin-1-interpreted UTF-8 bytes) — and emit a warning.
  readStringContent(n: number, followingChar: ';' | ':', tokenOffset: number): string {
    const followByte = followingChar.charCodeAt(0);

    const tryByteMode = (): string | null => {
      if (this.bytePos + n + 2 > this.bytes.length) return null;
      if (
        this.bytes[this.bytePos + n] !== 0x22 /* " */ ||
        this.bytes[this.bytePos + n + 1] !== followByte
      ) {
        return null;
      }
      const slice = this.bytes.subarray(this.bytePos, this.bytePos + n);
      const str = new TextDecoder('utf-8', { fatal: false }).decode(slice);
      this.bytePos += n;
      this.charPos += str.length;
      return str;
    };

    const tryCharMode = (): string | null => {
      if (this.charPos + n + 2 > this.chars.length) return null;
      if (
        this.chars[this.charPos + n] !== '"' ||
        this.chars[this.charPos + n + 1] !== followingChar
      ) {
        return null;
      }
      const str = this.chars.slice(this.charPos, this.charPos + n);
      const consumedBytes = new TextEncoder().encode(str).byteLength;
      this.bytePos += consumedBytes;
      this.charPos += n;
      return str;
    };

    switch (this.encoding) {
      case 'utf8': {
        const r = tryByteMode();
        if (r !== null) return r;
        throw new PhpSerializeError(
          `string length mismatch: claimed ${n} UTF-8 bytes, closing \`"${followingChar}\` ` +
            `not found at that offset. If this data came from a latin1-collated MySQL column, ` +
            `switch Source encoding to "Latin-1" or "Auto".`,
          tokenOffset,
        );
      }
      case 'latin1': {
        const r = tryCharMode();
        if (r !== null) return r;
        throw new PhpSerializeError(
          `string length mismatch: claimed ${n} chars (latin1), closing \`"${followingChar}\` ` +
            `not found at that offset. If this data is actually UTF-8, switch Source encoding to "UTF-8".`,
          tokenOffset,
        );
      }
      case 'auto': {
        const byteR = tryByteMode();
        if (byteR !== null) return byteR;
        const charR = tryCharMode();
        if (charR !== null) {
          this.warnings.push(
            `String at byte ${tokenOffset}: claimed length ${n} did not align as UTF-8 bytes; ` +
              `recovered using character count. This usually means the source was mojibake-encoded ` +
              `(e.g., from a latin1-collated MySQL column holding UTF-8 bytes).`,
          );
          return charR;
        }
        throw new PhpSerializeError(
          `string length mismatch: claimed ${n} but neither UTF-8 byte count nor character count ` +
            `lands on closing \`"${followingChar}\``,
          tokenOffset,
        );
      }
    }
  }
}

function parseIntMaybeBig(raw: string, offset: number): number | bigint {
  if (!/^-?\d+$/.test(raw)) throw new PhpSerializeError(`invalid integer "${raw}"`, offset);
  const big = BigInt(raw);
  if (big > MAX_SAFE || big < MIN_SAFE) return big;
  return Number(big);
}

function parseFloat_(raw: string, offset: number): number {
  if (raw === 'NAN') return NaN;
  if (raw === 'INF') return Infinity;
  if (raw === '-INF') return -Infinity;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new PhpSerializeError(`invalid float "${raw}"`, offset);
  return n;
}

function parseQuotedString(c: Cursor): string {
  c.expect(':');
  const lenStart = c.bytePos;
  const lenRaw = c.readAsciiUntil(':');
  const len = Number(parseIntMaybeBig(lenRaw, lenStart));
  if (!Number.isInteger(len) || len < 0) {
    throw new PhpSerializeError(`invalid string length ${lenRaw}`, lenStart);
  }
  c.expect(':');
  c.expect('"');
  const tokenOffset = c.bytePos;
  const value = c.readStringContent(len, ';', tokenOffset);
  c.expect('"');
  c.expect(';');
  return value;
}

function parseKey(c: Cursor): PhpKey {
  const tag = c.takeAscii();
  if (tag === 0x69 /* i */) {
    c.expect(':');
    const start = c.bytePos;
    const raw = c.readAsciiUntil(';');
    c.expect(';');
    return { kind: 'int', value: parseIntMaybeBig(raw, start) };
  }
  if (tag === 0x73 /* s */) {
    return { kind: 'string', value: parseQuotedString(c) };
  }
  throw new PhpSerializeError(
    `invalid array key tag '${String.fromCharCode(tag)}'`,
    c.bytePos - 1,
  );
}

function parseEntries(c: Cursor, count: number): Array<[PhpKey, PhpValue]> {
  c.expect('{');
  const entries: Array<[PhpKey, PhpValue]> = [];
  for (let i = 0; i < count; i++) {
    const k = parseKey(c);
    const v = parseValue(c);
    entries.push([k, v]);
  }
  c.expect('}');
  return entries;
}

function parseValue(c: Cursor): PhpValue {
  const tag = c.takeAscii();
  const ch = String.fromCharCode(tag);
  switch (ch) {
    case 'N': {
      c.expect(';');
      return { kind: 'null' };
    }
    case 'b': {
      c.expect(':');
      const v = c.takeAscii();
      c.expect(';');
      if (v !== 0x30 && v !== 0x31) {
        throw new PhpSerializeError(`invalid bool '${String.fromCharCode(v)}'`, c.bytePos - 1);
      }
      return { kind: 'bool', value: v === 0x31 };
    }
    case 'i': {
      c.expect(':');
      const start = c.bytePos;
      const raw = c.readAsciiUntil(';');
      c.expect(';');
      return { kind: 'int', value: parseIntMaybeBig(raw, start) };
    }
    case 'd': {
      c.expect(':');
      const start = c.bytePos;
      const raw = c.readAsciiUntil(';');
      c.expect(';');
      return { kind: 'float', value: parseFloat_(raw, start) };
    }
    case 's': {
      return { kind: 'string', value: parseQuotedString(c) };
    }
    case 'a': {
      c.expect(':');
      const countStart = c.bytePos;
      const countRaw = c.readAsciiUntil(':');
      const count = Number(parseIntMaybeBig(countRaw, countStart));
      if (!Number.isInteger(count) || count < 0) {
        throw new PhpSerializeError(`invalid array count ${countRaw}`, countStart);
      }
      c.expect(':');
      return { kind: 'array', entries: parseEntries(c, count) };
    }
    case 'O': {
      c.expect(':');
      const nameLenStart = c.bytePos;
      const nameLenRaw = c.readAsciiUntil(':');
      const nameLen = Number(parseIntMaybeBig(nameLenRaw, nameLenStart));
      if (!Number.isInteger(nameLen) || nameLen < 0) {
        throw new PhpSerializeError(`invalid class name length ${nameLenRaw}`, nameLenStart);
      }
      c.expect(':');
      c.expect('"');
      const tokenOffset = c.bytePos;
      const className = c.readStringContent(nameLen, ':', tokenOffset);
      c.expect('"');
      c.expect(':');
      const countStart = c.bytePos;
      const countRaw = c.readAsciiUntil(':');
      const count = Number(parseIntMaybeBig(countRaw, countStart));
      if (!Number.isInteger(count) || count < 0) {
        throw new PhpSerializeError(`invalid prop count ${countRaw}`, countStart);
      }
      c.expect(':');
      return { kind: 'object', className, entries: parseEntries(c, count) };
    }
    case 'r':
    case 'R': {
      c.expect(':');
      const start = c.bytePos;
      const raw = c.readAsciiUntil(';');
      c.expect(';');
      const target = Number(parseIntMaybeBig(raw, start));
      return { kind: 'ref', target, isObjectRef: ch === 'R' };
    }
    default:
      throw new PhpSerializeError(`unknown tag '${ch}'`, c.bytePos - 1);
  }
}

// Public API. Pass options to control source encoding and collect warnings.
export function unserialize(input: string, opts: UnserializeOptions = {}): PhpValue {
  const encoding = opts.encoding ?? 'utf8';
  const warnings = opts.warnings ?? [];
  const c = new Cursor(input, encoding, warnings);
  const v = parseValue(c);
  c.skipWhitespace();
  if (!c.eof()) {
    throw new PhpSerializeError('trailing data after value', c.bytePos);
  }
  return v;
}
