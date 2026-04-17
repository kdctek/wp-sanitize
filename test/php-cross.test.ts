import { describe, it, expect } from 'vitest';
import { serialize } from '../src/serialize.ts';
import { unserialize } from '../src/unserialize.ts';

// Outputs captured from real PHP 8.5 (php -r 'echo serialize(...);').
// We round-trip each one through our implementation and expect byte equality.
const PHP_CASES: Array<[string, string]> = [
  ['string cafe', 's:5:"café";'],
  ['string with embedded quotes', 's:12:"he said "hi"";'],
  ['string with emoji', 's:11:"👍 thumbs";'],
  ['assoc array', 'a:2:{s:4:"name";s:5:"Kevin";s:3:"age";i:42;}'],
  ['nested arrays', 'a:1:{s:6:"nested";a:2:{s:1:"a";i:1;s:1:"b";a:3:{i:0;i:1;i:1;i:2;i:2;i:3;}}}'],
  ['large int (beyond 2^53)', 'i:9007199254740993;'],
  ['float 3.14', 'd:3.14;'],
  ['null', 'N;'],
  ['bool true', 'b:1;'],
  ['bool false', 'b:0;'],
];

describe('PHP 8.5 output fidelity — parse real PHP output, re-emit byte-for-byte', () => {
  for (const [label, input] of PHP_CASES) {
    it(label, () => {
      const parsed = unserialize(input);
      expect(serialize(parsed)).toBe(input);
    });
  }
});
