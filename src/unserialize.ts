import { PhpSerializeError, type PhpKey, type PhpValue } from './types.ts';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

class Cursor {
  readonly bytes: Uint8Array;
  pos = 0;
  constructor(input: string) {
    this.bytes = new TextEncoder().encode(input);
  }
  eof(): boolean {
    return this.pos >= this.bytes.length;
  }
  peek(): number | undefined {
    return this.bytes[this.pos];
  }
  take(): number {
    const b = this.bytes[this.pos];
    if (b === undefined) throw new PhpSerializeError('unexpected end of input', this.pos);
    this.pos++;
    return b;
  }
  expect(ch: string): void {
    const want = ch.charCodeAt(0);
    const got = this.take();
    if (got !== want) {
      throw new PhpSerializeError(
        `expected '${ch}' but got '${String.fromCharCode(got)}'`,
        this.pos - 1,
      );
    }
  }
  readUntil(ch: string): string {
    const want = ch.charCodeAt(0);
    const start = this.pos;
    while (!this.eof() && this.bytes[this.pos] !== want) this.pos++;
    if (this.eof()) throw new PhpSerializeError(`expected '${ch}'`, this.pos);
    const slice = this.bytes.subarray(start, this.pos);
    return new TextDecoder('utf-8', { fatal: false }).decode(slice);
  }
  readBytes(n: number): string {
    if (this.pos + n > this.bytes.length) {
      throw new PhpSerializeError(
        `string underflow: wanted ${n} bytes, have ${this.bytes.length - this.pos}`,
        this.pos,
      );
    }
    const slice = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return new TextDecoder('utf-8', { fatal: false }).decode(slice);
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

function parseKey(c: Cursor): PhpKey {
  const tag = c.take();
  if (tag === 0x69 /* i */) {
    c.expect(':');
    const start = c.pos;
    const raw = c.readUntil(';');
    c.expect(';');
    return { kind: 'int', value: parseIntMaybeBig(raw, start) };
  }
  if (tag === 0x73 /* s */) {
    c.expect(':');
    const lenStart = c.pos;
    const lenRaw = c.readUntil(':');
    const len = Number(parseIntMaybeBig(lenRaw, lenStart));
    if (!Number.isInteger(len) || len < 0) {
      throw new PhpSerializeError(`invalid string length ${lenRaw}`, lenStart);
    }
    c.expect(':');
    c.expect('"');
    const value = c.readBytes(len);
    c.expect('"');
    c.expect(';');
    return { kind: 'string', value };
  }
  throw new PhpSerializeError(`invalid array key tag '${String.fromCharCode(tag)}'`, c.pos - 1);
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
  const tag = c.take();
  const ch = String.fromCharCode(tag);
  switch (ch) {
    case 'N': {
      c.expect(';');
      return { kind: 'null' };
    }
    case 'b': {
      c.expect(':');
      const v = c.take();
      c.expect(';');
      if (v !== 0x30 && v !== 0x31) {
        throw new PhpSerializeError(`invalid bool '${String.fromCharCode(v)}'`, c.pos - 1);
      }
      return { kind: 'bool', value: v === 0x31 };
    }
    case 'i': {
      c.expect(':');
      const start = c.pos;
      const raw = c.readUntil(';');
      c.expect(';');
      return { kind: 'int', value: parseIntMaybeBig(raw, start) };
    }
    case 'd': {
      c.expect(':');
      const start = c.pos;
      const raw = c.readUntil(';');
      c.expect(';');
      return { kind: 'float', value: parseFloat_(raw, start) };
    }
    case 's': {
      c.expect(':');
      const lenStart = c.pos;
      const lenRaw = c.readUntil(':');
      const len = Number(parseIntMaybeBig(lenRaw, lenStart));
      if (!Number.isInteger(len) || len < 0) {
        throw new PhpSerializeError(`invalid string length ${lenRaw}`, lenStart);
      }
      c.expect(':');
      c.expect('"');
      const value = c.readBytes(len);
      c.expect('"');
      c.expect(';');
      return { kind: 'string', value };
    }
    case 'a': {
      c.expect(':');
      const countStart = c.pos;
      const countRaw = c.readUntil(':');
      const count = Number(parseIntMaybeBig(countRaw, countStart));
      if (!Number.isInteger(count) || count < 0) {
        throw new PhpSerializeError(`invalid array count ${countRaw}`, countStart);
      }
      c.expect(':');
      return { kind: 'array', entries: parseEntries(c, count) };
    }
    case 'O': {
      c.expect(':');
      const nameLenStart = c.pos;
      const nameLenRaw = c.readUntil(':');
      const nameLen = Number(parseIntMaybeBig(nameLenRaw, nameLenStart));
      if (!Number.isInteger(nameLen) || nameLen < 0) {
        throw new PhpSerializeError(`invalid class name length ${nameLenRaw}`, nameLenStart);
      }
      c.expect(':');
      c.expect('"');
      const className = c.readBytes(nameLen);
      c.expect('"');
      c.expect(':');
      const countStart = c.pos;
      const countRaw = c.readUntil(':');
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
      const start = c.pos;
      const raw = c.readUntil(';');
      c.expect(';');
      const target = Number(parseIntMaybeBig(raw, start));
      return { kind: 'ref', target, isObjectRef: ch === 'R' };
    }
    default:
      throw new PhpSerializeError(`unknown tag '${ch}'`, c.pos - 1);
  }
}

export function unserialize(input: string): PhpValue {
  const c = new Cursor(input);
  const v = parseValue(c);
  // Allow trailing whitespace; some dumps have it
  while (!c.eof()) {
    const b = c.peek();
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
      c.pos++;
      continue;
    }
    throw new PhpSerializeError('trailing data after value', c.pos);
  }
  return v;
}
