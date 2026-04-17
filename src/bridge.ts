import { PhpSerializeError, type PhpKey, type PhpValue } from './types.ts';

// Sentinels used in the JSON representation for PHP-specific concepts that
// don't have a native JSON equivalent.
export const CLASS_SENTINEL = '__class__';
export const BIGINT_SENTINEL = '__bigint__';
export const REF_SENTINEL = '__ref__';
export const REF_OBJ_SENTINEL = '__ref_object__';
export const ASSOC_ORDER_SENTINEL = '__order__';

// Type of plain JSON values, mirroring what JSON.parse produces.
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [k: string]: Json };

function isSequentialIntKeys(entries: Array<[PhpKey, PhpValue]>): boolean {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) return false;
    const [k] = entry;
    if (k.kind !== 'int') return false;
    const n = typeof k.value === 'bigint' ? k.value : BigInt(k.value);
    if (n !== BigInt(i)) return false;
  }
  return true;
}

function keyToJsonKey(k: PhpKey): string {
  if (k.kind === 'int') return k.value.toString();
  return k.value;
}

// JS plain objects reorder integer-like keys numerically-ascending before any
// insertion-ordered string keys. When the original PHP entries don't match
// that natural order, we emit an __order__ sentinel to preserve fidelity.
function naturalJsOrder(keys: string[]): string[] {
  const intKeys: string[] = [];
  const strKeys: string[] = [];
  const INT_RE = /^(?:0|-?[1-9]\d*)$/;
  for (const k of keys) {
    if (INT_RE.test(k) && Number(k) >= 0 && Number(k) <= 2 ** 32 - 2) {
      intKeys.push(k);
    } else {
      strKeys.push(k);
    }
  }
  intKeys.sort((a, b) => Number(a) - Number(b));
  return [...intKeys, ...strKeys];
}

function entriesToObject(entries: Array<[PhpKey, PhpValue]>): Record<string, Json> {
  const keys = entries.map(([k]) => keyToJsonKey(k));
  const natural = naturalJsOrder(keys);
  const orderPreserved = keys.every((k, i) => k === natural[i]);
  const obj: Record<string, Json> = {};
  for (const [k, val] of entries) obj[keyToJsonKey(k)] = phpToJson(val);
  if (!orderPreserved) obj[ASSOC_ORDER_SENTINEL] = keys;
  return obj;
}

export function phpToJson(v: PhpValue): Json {
  switch (v.kind) {
    case 'null':
      return null;
    case 'bool':
      return v.value;
    case 'int':
      if (typeof v.value === 'bigint') return { [BIGINT_SENTINEL]: v.value.toString() };
      return v.value;
    case 'float':
      if (Number.isNaN(v.value) || !Number.isFinite(v.value)) {
        // JSON can't represent these; stringify as a sentinel to preserve them.
        return { __float__: v.value.toString() };
      }
      return v.value;
    case 'string':
      return v.value;
    case 'array': {
      if (isSequentialIntKeys(v.entries)) {
        return v.entries.map(([, val]) => phpToJson(val));
      }
      return entriesToObject(v.entries);
    }
    case 'object': {
      const obj = entriesToObject(v.entries);
      // __class__ goes first so it's visible in the editor.
      return { [CLASS_SENTINEL]: v.className, ...obj };
    }
    case 'ref':
      return v.isObjectRef
        ? { [REF_OBJ_SENTINEL]: v.target }
        : { [REF_SENTINEL]: v.target };
  }
}

// Keys in JSON are always strings. If the string parses as a PHP-style integer
// literal (no leading zeros except "0" itself, no "+"), treat it as an int key.
// This mirrors PHP's own key normalization.
function stringToPhpKey(s: string): PhpKey {
  if (/^(?:0|-?[1-9]\d*)$/.test(s)) {
    const big = BigInt(s);
    const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
    const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
    if (big > MAX_SAFE || big < MIN_SAFE) return { kind: 'int', value: big };
    return { kind: 'int', value: Number(big) };
  }
  return { kind: 'string', value: s };
}

function isPlainObject(v: Json): v is { [k: string]: Json } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function jsonToPhp(v: Json): PhpValue {
  if (v === null) return { kind: 'null' };
  if (typeof v === 'boolean') return { kind: 'bool', value: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { kind: 'int', value: v };
    return { kind: 'float', value: v };
  }
  if (typeof v === 'string') return { kind: 'string', value: v };
  if (Array.isArray(v)) {
    const entries: Array<[PhpKey, PhpValue]> = v.map((item, i) => [
      { kind: 'int', value: i } as PhpKey,
      jsonToPhp(item),
    ]);
    return { kind: 'array', entries };
  }
  if (isPlainObject(v)) {
    // Sentinels
    if (BIGINT_SENTINEL in v && typeof v[BIGINT_SENTINEL] === 'string') {
      return { kind: 'int', value: BigInt(v[BIGINT_SENTINEL] as string) };
    }
    if ('__float__' in v && typeof v['__float__'] === 'string') {
      const raw = v['__float__'] as string;
      const n = raw === 'NaN' ? NaN : raw === 'Infinity' ? Infinity : raw === '-Infinity' ? -Infinity : Number(raw);
      return { kind: 'float', value: n };
    }
    if (REF_SENTINEL in v && typeof v[REF_SENTINEL] === 'number') {
      return { kind: 'ref', target: v[REF_SENTINEL] as number, isObjectRef: false };
    }
    if (REF_OBJ_SENTINEL in v && typeof v[REF_OBJ_SENTINEL] === 'number') {
      return { kind: 'ref', target: v[REF_OBJ_SENTINEL] as number, isObjectRef: true };
    }

    const classNameRaw = v[CLASS_SENTINEL];
    const orderRaw = v[ASSOC_ORDER_SENTINEL];
    const order = Array.isArray(orderRaw) && orderRaw.every((x) => typeof x === 'string')
      ? (orderRaw as string[])
      : null;

    const rawKeys = Object.keys(v).filter(
      (k) => k !== CLASS_SENTINEL && k !== ASSOC_ORDER_SENTINEL,
    );
    const keys = order ? order.filter((k) => k in v) : rawKeys;

    const entries: Array<[PhpKey, PhpValue]> = keys.map((k) => {
      const val = v[k];
      if (val === undefined) {
        throw new PhpSerializeError(`missing key "${k}"`);
      }
      return [stringToPhpKey(k), jsonToPhp(val)];
    });

    if (typeof classNameRaw === 'string') {
      return { kind: 'object', className: classNameRaw, entries };
    }
    return { kind: 'array', entries };
  }
  throw new PhpSerializeError(`unsupported JSON value: ${typeof v}`);
}
