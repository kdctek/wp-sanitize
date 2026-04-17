import { describe, it, expect } from 'vitest';
import { serialize } from '../src/serialize.ts';

describe('serialize — primitives', () => {
  it('serializes null', () => {
    expect(serialize({ kind: 'null' })).toBe('N;');
  });
  it('serializes booleans', () => {
    expect(serialize({ kind: 'bool', value: false })).toBe('b:0;');
    expect(serialize({ kind: 'bool', value: true })).toBe('b:1;');
  });
  it('serializes integers', () => {
    expect(serialize({ kind: 'int', value: 0 })).toBe('i:0;');
    expect(serialize({ kind: 'int', value: -17 })).toBe('i:-17;');
    expect(serialize({ kind: 'int', value: 9223372036854775807n })).toBe('i:9223372036854775807;');
  });
  it('serializes floats with specials', () => {
    expect(serialize({ kind: 'float', value: 3.14 })).toBe('d:3.14;');
    expect(serialize({ kind: 'float', value: NaN })).toBe('d:NAN;');
    expect(serialize({ kind: 'float', value: Infinity })).toBe('d:INF;');
    expect(serialize({ kind: 'float', value: -Infinity })).toBe('d:-INF;');
  });
});

describe('serialize — strings with UTF-8 byte length', () => {
  it('uses byte length not char length', () => {
    expect(serialize({ kind: 'string', value: 'café' })).toBe('s:5:"café";');
    expect(serialize({ kind: 'string', value: '👍' })).toBe('s:4:"👍";');
    expect(serialize({ kind: 'string', value: '' })).toBe('s:0:"";');
    expect(serialize({ kind: 'string', value: 'hello' })).toBe('s:5:"hello";');
  });
  it('does not escape double quotes', () => {
    const s = 'he said "hi"';
    const bytes = new TextEncoder().encode(s).byteLength;
    expect(serialize({ kind: 'string', value: s })).toBe(`s:${bytes}:"${s}";`);
  });
});

describe('serialize — collections', () => {
  it('serializes empty array', () => {
    expect(serialize({ kind: 'array', entries: [] })).toBe('a:0:{}');
  });
  it('serializes associative array', () => {
    const out = serialize({
      kind: 'array',
      entries: [
        [{ kind: 'string', value: 'name' }, { kind: 'string', value: 'Kevin' }],
        [{ kind: 'string', value: 'age' }, { kind: 'int', value: 42 }],
      ],
    });
    expect(out).toBe('a:2:{s:4:"name";s:5:"Kevin";s:3:"age";i:42;}');
  });
  it('serializes object with class name using class name byte length', () => {
    const out = serialize({
      kind: 'object',
      className: 'MyCls',
      entries: [[{ kind: 'string', value: 'x' }, { kind: 'int', value: 7 }]],
    });
    expect(out).toBe('O:5:"MyCls":1:{s:1:"x";i:7;}');
  });
});
