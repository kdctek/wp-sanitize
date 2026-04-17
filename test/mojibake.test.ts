import { describe, it, expect } from 'vitest';
import { unserialize } from '../src/unserialize.ts';
import { serialize } from '../src/serialize.ts';

// When WP data comes out of a mis-configured DB connection (e.g. the client
// charset is latin1 but the columns actually hold UTF-8 bytes), multi-byte
// characters arrive as the wrong unicode characters but the original byte
// counts in the serialized blob still reflect the *original* UTF-8 lengths.
// Our parser needs to recover from this.

describe('mojibake recovery', () => {
  it('decodes mojibake rupee symbol (byte count 3, content is 3 JS chars / 7 UTF-8 bytes)', () => {
    // Real shape from a WordPress options blob where ₹ (E2 82 B9, 3 bytes)
    // was re-encoded to latin1 and arrived as the characters "â‚¹" (3 chars).
    const input = 's:3:"â‚¹";';
    const warnings: string[] = [];
    const v = unserialize(input, { encoding: 'auto', warnings });
    expect(v).toEqual({ kind: 'string', value: 'â‚¹' });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/character count/);
  });

  it('preserves strict UTF-8 strings without warning', () => {
    const warnings: string[] = [];
    const v = unserialize('s:5:"café";', { encoding: 'auto', warnings });
    expect(v).toEqual({ kind: 'string', value: 'café' });
    expect(warnings).toEqual([]);
  });

  it('re-encodes mojibake input with correct UTF-8 byte counts (encoding=utf8)', () => {
    // After recovery, serialize in utf8 mode emits the real UTF-8 byte count
    // of the recovered string (7 bytes for "â‚¹").
    const input = 's:3:"â‚¹";';
    const v = unserialize(input, { encoding: 'auto' });
    expect(serialize(v, { encoding: 'utf8' })).toBe('s:7:"â‚¹";');
  });

  it('re-encodes mojibake input with original char counts (encoding=latin1)', () => {
    // In latin1 mode, byte counts use JS char length — matching the original
    // so the payload can be pasted back into a latin1-collated column.
    const input = 's:3:"â‚¹";';
    const v = unserialize(input, { encoding: 'latin1' });
    expect(serialize(v, { encoding: 'latin1' })).toBe('s:3:"â‚¹";');
  });

  it('handles the user-reported sample (33-entry options blob with mojibake rupee)', () => {
    // Excerpt of the real user blob, enough to exercise the mojibake path.
    const input =
      'a:2:{s:20:"fees_currency_symbol";s:3:"â‚¹";s:22:"fees_currency_decimals";i:0;}';
    const warnings: string[] = [];
    const v = unserialize(input, { encoding: 'auto', warnings });
    expect(v.kind).toBe('array');
    if (v.kind === 'array') {
      expect(v.entries[0]?.[1]).toEqual({ kind: 'string', value: 'â‚¹' });
      expect(v.entries[1]?.[1]).toEqual({ kind: 'int', value: 0 });
    }
    expect(warnings.length).toBe(1);
  });

  it('throws a helpful error when a string length is truly wrong', () => {
    // No byte-count OR char-count lands on `";`
    expect(() => unserialize('s:10:"hi";', { encoding: 'auto' })).toThrow(/length mismatch/);
  });

  it('utf8 mode rejects mojibake with a hint about Latin-1', () => {
    expect(() => unserialize('s:3:"â‚¹";', { encoding: 'utf8' })).toThrow(/Latin-1|latin1/);
  });

  it('latin1 mode decodes mojibake silently (no warnings)', () => {
    const warnings: string[] = [];
    const v = unserialize('s:3:"â‚¹";', { encoding: 'latin1', warnings });
    expect(v).toEqual({ kind: 'string', value: 'â‚¹' });
    expect(warnings).toEqual([]);
  });

  it('latin1 encode treats CP-1252 high chars as single bytes without warning', () => {
    // MySQL `latin1` is actually CP-1252. U+201A (‚), U+20AC (€), U+2026 (…)
    // etc. map to single bytes in CP-1252 so they should NOT trigger warnings.
    const warnings: string[] = [];
    const v = {
      kind: 'string' as const,
      value: '‚€… quotes "" —',
    };
    const out = serialize(v, { encoding: 'latin1', warnings });
    expect(warnings).toEqual([]);
    // char count: 14 ('‚' + '€' + '…' + ' ' + 'q' + 'u' + 'o' + 't' + 'e' + 's' + ' ' + '"' + '"' + ' ' + '—' = 15)
    expect(out).toMatch(/^s:\d+:"/);
  });

  it('latin1 encode warns when a non-CP-1252 char is present (e.g. emoji)', () => {
    const warnings: string[] = [];
    serialize({ kind: 'string', value: 'thumbs 👍' }, { encoding: 'latin1', warnings });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/cannot represent/);
  });
});
