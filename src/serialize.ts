import { PhpSerializeError, type PhpKey, type PhpValue } from './types.ts';

const encoder = new TextEncoder();

function byteLen(s: string): number {
  return encoder.encode(s).byteLength;
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
  // Use the shortest round-trippable representation. For values with no
  // fractional part, PHP emits e.g. "42" — Number.toString does the same.
  return `d:${v.toString()};`;
}

function serializeString(s: string): string {
  return `s:${byteLen(s)}:"${s}";`;
}

function serializeKey(k: PhpKey): string {
  if (k.kind === 'int') return serializeInt(k.value);
  return serializeString(k.value);
}

export function serialize(v: PhpValue): string {
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
      const body = v.entries.map(([k, val]) => serializeKey(k) + serialize(val)).join('');
      return `a:${v.entries.length}:{${body}}`;
    }
    case 'object': {
      const body = v.entries.map(([k, val]) => serializeKey(k) + serialize(val)).join('');
      return `O:${byteLen(v.className)}:"${v.className}":${v.entries.length}:{${body}}`;
    }
    case 'ref':
      return `${v.isObjectRef ? 'R' : 'r'}:${v.target};`;
  }
}
