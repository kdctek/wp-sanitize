import { PhpSerializeError, type PhpKey, type PhpValue } from './types.ts';

export type Encoding = 'utf8' | 'latin1';

export interface SerializeOptions {
  // 'utf8'   — byte counts are UTF-8 byte lengths (WordPress default).
  // 'latin1' — byte counts are JS char counts (code units). Appropriate when
  //            the destination MySQL column is latin1_*-collated and each
  //            character in the payload is <= U+00FF. For chars above that
  //            the count would under-report the real Latin-1 byte length,
  //            which Latin-1 itself can't encode — we emit a warning.
  encoding?: Encoding;
  warnings?: string[];
}

const encoder = new TextEncoder();

function utf8ByteLen(s: string): number {
  return encoder.encode(s).byteLength;
}

function latin1CharLen(s: string, warnings?: string[]): number {
  if (warnings) {
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code > 0xff) {
        warnings.push(
          `Latin-1 encoding cannot represent character U+${code
            .toString(16)
            .toUpperCase()
            .padStart(4, '0')} in "${s.slice(0, 40)}${s.length > 40 ? '…' : ''}". ` +
            `Emitting char-count anyway; consider switching encoding to UTF-8.`,
        );
        break;
      }
    }
  }
  return s.length;
}

function serializeInt(v: number | bigint): string {
  if (typeof v === 'bigint') return `i:${v.toString()};`;
  if (!Number.isInteger(v)) {
    throw new PhpSerializeError(`int value must be an integer, got ${v}`);
  }
  return `i:${v.toString()};`;
}

function serializeFloat(v: number): string {
  if (Number.isNaN(v)) return 'd:NAN;';
  if (v === Infinity) return 'd:INF;';
  if (v === -Infinity) return 'd:-INF;';
  return `d:${v.toString()};`;
}

function makeWriter(encoding: Encoding, warnings?: string[]) {
  const len = encoding === 'latin1' ? (s: string) => latin1CharLen(s, warnings) : utf8ByteLen;

  const serializeString = (s: string): string => `s:${len(s)}:"${s}";`;

  const serializeKey = (k: PhpKey): string =>
    k.kind === 'int' ? serializeInt(k.value) : serializeString(k.value);

  const go = (v: PhpValue): string => {
    switch (v.kind) {
      case 'null':
        return 'N;';
      case 'bool':
        return `b:${v.value ? 1 : 0};`;
      case 'int':
        return serializeInt(v.value);
      case 'float':
        return serializeFloat(v.value);
      case 'string':
        return serializeString(v.value);
      case 'array': {
        const body = v.entries.map(([k, val]) => serializeKey(k) + go(val)).join('');
        return `a:${v.entries.length}:{${body}}`;
      }
      case 'object': {
        const body = v.entries.map(([k, val]) => serializeKey(k) + go(val)).join('');
        return `O:${len(v.className)}:"${v.className}":${v.entries.length}:{${body}}`;
      }
      case 'ref':
        return `${v.isObjectRef ? 'R' : 'r'}:${v.target};`;
    }
  };

  return go;
}

export function serialize(v: PhpValue, opts: SerializeOptions = {}): string {
  const encoding = opts.encoding ?? 'utf8';
  return makeWriter(encoding, opts.warnings)(v);
}
