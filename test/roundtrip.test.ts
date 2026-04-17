import { describe, it, expect } from 'vitest';
import { serialize } from '../src/serialize.ts';
import { unserialize } from '../src/unserialize.ts';
import { phpToJson, jsonToPhp } from '../src/bridge.ts';

const FIXTURES: string[] = [
  // simple WP-ish assoc array (a style preset blob shape)
  'a:2:{s:4:"name";s:5:"Kevin";s:3:"age";i:42;}',

  // nested arrays
  'a:1:{s:4:"list";a:3:{i:0;i:1;i:1;i:2;i:2;i:3;}}',

  // empty array
  'a:0:{}',

  // deeply nested, with mixed types
  'a:3:{s:5:"title";s:11:"Hello World";s:5:"count";i:7;s:4:"tags";a:2:{i:0;s:3:"foo";i:1;s:3:"bar";}}',

  // strings with UTF-8 (é=2 bytes, ☕=3 bytes → "café ☕" = 9 bytes)
  'a:1:{s:5:"greet";s:9:"café ☕";}',

  // object with class
  'O:8:"stdClass":2:{s:1:"x";i:1;s:1:"y";i:2;}',

  // widget-like nested blob
  'a:1:{s:13:"widget_block1";a:1:{s:7:"content";s:11:"hello world";}}',

  // null, bool, float
  'a:3:{s:1:"a";N;s:1:"b";b:1;s:1:"c";d:1.5;}',
];

describe('round-trip: serialize ∘ unserialize = id (byte-for-byte)', () => {
  for (const input of FIXTURES) {
    it(`preserves: ${input.length > 60 ? input.slice(0, 57) + '...' : input}`, () => {
      const parsed = unserialize(input);
      const emitted = serialize(parsed);
      expect(emitted).toBe(input);
    });
  }
});

describe('round-trip through JSON bridge', () => {
  for (const input of FIXTURES) {
    it(`preserves through bridge: ${input.length > 60 ? input.slice(0, 57) + '...' : input}`, () => {
      const parsed = unserialize(input);
      const json = phpToJson(parsed);
      const back = jsonToPhp(json);
      const emitted = serialize(back);
      expect(emitted).toBe(input);
    });
  }
});

describe('JSON bridge shape', () => {
  it('renders assoc array as plain object', () => {
    const v = unserialize('a:2:{s:4:"name";s:5:"Kevin";s:3:"age";i:42;}');
    expect(phpToJson(v)).toEqual({ name: 'Kevin', age: 42 });
  });
  it('renders sequential int-keyed array as JS array', () => {
    const v = unserialize('a:3:{i:0;s:1:"a";i:1;s:1:"b";i:2;s:1:"c";}');
    expect(phpToJson(v)).toEqual(['a', 'b', 'c']);
  });
  it('preserves order for non-natural int-keyed maps via __order__', () => {
    // Reverse-order int keys: natural JS order would normalize to 0,1,2.
    const v = unserialize('a:3:{i:2;s:1:"c";i:0;s:1:"a";i:1;s:1:"b";}');
    const json = phpToJson(v) as { [k: string]: unknown };
    expect(json['__order__']).toEqual(['2', '0', '1']);
    const back = jsonToPhp(json as never);
    expect(serialize(back)).toBe('a:3:{i:2;s:1:"c";i:0;s:1:"a";i:1;s:1:"b";}');
  });
  it('round-trips objects via __class__ sentinel', () => {
    const v = unserialize('O:5:"MyCls":1:{s:1:"x";i:7;}');
    const json = phpToJson(v);
    expect(json).toEqual({ __class__: 'MyCls', x: 7 });
    expect(serialize(jsonToPhp(json))).toBe('O:5:"MyCls":1:{s:1:"x";i:7;}');
  });
});

describe('real-world WP option shape', () => {
  it('parses and re-emits a widget_block-ish option', () => {
    const input =
      'a:3:{i:2;a:2:{s:7:"content";s:27:"<!-- wp:paragraph --><p>hi</p>";s:5:"title";s:0:"";}i:_multiwidget;i:1;i:3;a:1:{s:7:"content";s:4:"wut?";}}';
    // NOTE: this fixture intentionally has an int-ish string key "_multiwidget"
    // which is actually a string. Ensure we don't misclassify it.
    // Correct PHP would serialize "_multiwidget" as a string key — fix the fixture.
    const fixed =
      'a:3:{i:2;a:2:{s:7:"content";s:30:"<!-- wp:paragraph --><p>hi</p>";s:5:"title";s:0:"";}s:12:"_multiwidget";i:1;i:3;a:1:{s:7:"content";s:4:"wut?";}}';
    const parsed = unserialize(fixed);
    expect(serialize(parsed)).toBe(fixed);
    // also check silly fixture throws cleanly to prove our length validation
    expect(() => unserialize(input)).toThrow();
  });
});
