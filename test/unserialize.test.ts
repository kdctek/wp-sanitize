import { describe, it, expect } from 'vitest';
import { unserialize } from '../src/unserialize.ts';
import { PhpSerializeError } from '../src/types.ts';

describe('unserialize — primitives', () => {
  it('parses null', () => {
    expect(unserialize('N;')).toEqual({ kind: 'null' });
  });
  it('parses booleans', () => {
    expect(unserialize('b:0;')).toEqual({ kind: 'bool', value: false });
    expect(unserialize('b:1;')).toEqual({ kind: 'bool', value: true });
  });
  it('parses positive and negative integers', () => {
    expect(unserialize('i:0;')).toEqual({ kind: 'int', value: 0 });
    expect(unserialize('i:42;')).toEqual({ kind: 'int', value: 42 });
    expect(unserialize('i:-17;')).toEqual({ kind: 'int', value: -17 });
  });
  it('parses integers above 2^53 as BigInt', () => {
    const result = unserialize('i:9223372036854775807;');
    expect(result).toEqual({ kind: 'int', value: 9223372036854775807n });
  });
  it('parses floats including NAN and INF', () => {
    expect(unserialize('d:3.14;')).toEqual({ kind: 'float', value: 3.14 });
    expect(unserialize('d:-0.5;')).toEqual({ kind: 'float', value: -0.5 });
    const nan = unserialize('d:NAN;');
    expect(nan.kind === 'float' && Number.isNaN(nan.value)).toBe(true);
    expect(unserialize('d:INF;')).toEqual({ kind: 'float', value: Infinity });
    expect(unserialize('d:-INF;')).toEqual({ kind: 'float', value: -Infinity });
  });
});

describe('unserialize — strings with UTF-8', () => {
  it('parses ASCII strings', () => {
    expect(unserialize('s:5:"hello";')).toEqual({ kind: 'string', value: 'hello' });
  });
  it('parses empty string', () => {
    expect(unserialize('s:0:"";')).toEqual({ kind: 'string', value: '' });
  });
  it('parses strings with embedded quotes (no escaping in PHP)', () => {
    // PHP serialize emits s:N:"..." where N is byte length; quotes inside
    // the payload are not escaped — the parser must consume exactly N bytes.
    const s = 'he said "hi"';
    const input = `s:${new TextEncoder().encode(s).byteLength}:"${s}";`;
    expect(unserialize(input)).toEqual({ kind: 'string', value: s });
  });
  it('parses multi-byte UTF-8 strings using byte length', () => {
    // "café" is 4 chars but 5 bytes (é = 0xC3 0xA9).
    expect(unserialize('s:5:"café";')).toEqual({ kind: 'string', value: 'café' });
  });
  it('parses emoji using byte length', () => {
    // "👍" is 1 char (surrogate pair in JS: length 2) but 4 bytes in UTF-8.
    expect(unserialize('s:4:"👍";')).toEqual({ kind: 'string', value: '👍' });
  });
});

describe('unserialize — arrays and objects', () => {
  it('parses empty array', () => {
    expect(unserialize('a:0:{}')).toEqual({ kind: 'array', entries: [] });
  });
  it('parses indexed array', () => {
    expect(unserialize('a:2:{i:0;s:1:"a";i:1;s:1:"b";}')).toEqual({
      kind: 'array',
      entries: [
        [{ kind: 'int', value: 0 }, { kind: 'string', value: 'a' }],
        [{ kind: 'int', value: 1 }, { kind: 'string', value: 'b' }],
      ],
    });
  });
  it('parses associative array', () => {
    expect(unserialize('a:2:{s:4:"name";s:5:"Kevin";s:3:"age";i:42;}')).toEqual({
      kind: 'array',
      entries: [
        [{ kind: 'string', value: 'name' }, { kind: 'string', value: 'Kevin' }],
        [{ kind: 'string', value: 'age' }, { kind: 'int', value: 42 }],
      ],
    });
  });
  it('parses nested arrays', () => {
    const input = 'a:1:{s:4:"list";a:2:{i:0;i:1;i:1;i:2;}}';
    expect(unserialize(input)).toEqual({
      kind: 'array',
      entries: [
        [
          { kind: 'string', value: 'list' },
          {
            kind: 'array',
            entries: [
              [{ kind: 'int', value: 0 }, { kind: 'int', value: 1 }],
              [{ kind: 'int', value: 1 }, { kind: 'int', value: 2 }],
            ],
          },
        ],
      ],
    });
  });
  it('parses objects with class names', () => {
    expect(unserialize('O:5:"MyCls":1:{s:1:"x";i:7;}')).toEqual({
      kind: 'object',
      className: 'MyCls',
      entries: [[{ kind: 'string', value: 'x' }, { kind: 'int', value: 7 }]],
    });
  });
});

describe('unserialize — references', () => {
  it('parses value references', () => {
    // a:2:{i:0;s:1:"x";i:1;r:2;}  — second entry is ref to the first string
    const v = unserialize('a:2:{i:0;s:1:"x";i:1;r:2;}');
    expect(v.kind).toBe('array');
    if (v.kind === 'array') {
      expect(v.entries[1]?.[1]).toEqual({ kind: 'ref', target: 2, isObjectRef: false });
    }
  });
  it('parses object references', () => {
    const v = unserialize('a:1:{i:0;R:1;}');
    if (v.kind === 'array') {
      expect(v.entries[0]?.[1]).toEqual({ kind: 'ref', target: 1, isObjectRef: true });
    }
  });
});

describe('unserialize — errors', () => {
  it('rejects unknown tags', () => {
    expect(() => unserialize('X:0;')).toThrow(PhpSerializeError);
  });
  it('rejects byte-count underflow', () => {
    expect(() => unserialize('s:10:"hi";')).toThrow(PhpSerializeError);
  });
  it('rejects trailing garbage', () => {
    expect(() => unserialize('N;N;')).toThrow(PhpSerializeError);
  });
  it('allows trailing whitespace', () => {
    expect(unserialize('N;\n')).toEqual({ kind: 'null' });
  });
});
