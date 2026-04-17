import { describe, it, expect } from 'vitest';
import { WP_COLLATIONS, collationToEncoding } from '../src/collations.ts';

describe('collationToEncoding', () => {
  it('maps utf8mb4 collations to utf8', () => {
    expect(collationToEncoding('utf8mb4_unicode_ci')).toBe('utf8');
    expect(collationToEncoding('utf8mb4_0900_ai_ci')).toBe('utf8');
    expect(collationToEncoding('utf8mb4_bin')).toBe('utf8');
  });

  it('maps utf8mb3 and utf8 collations to utf8', () => {
    expect(collationToEncoding('utf8mb3_general_ci')).toBe('utf8');
    expect(collationToEncoding('utf8_bin')).toBe('utf8');
  });

  it('maps latin1 collations to latin1', () => {
    expect(collationToEncoding('latin1_swedish_ci')).toBe('latin1');
    expect(collationToEncoding('latin1_general_cs')).toBe('latin1');
  });

  it('maps ascii collations to latin1 bucket', () => {
    expect(collationToEncoding('ascii_bin')).toBe('latin1');
    expect(collationToEncoding('ascii_general_ci')).toBe('latin1');
  });
});

describe('WP_COLLATIONS', () => {
  it('every option in a group maps to the group bucket', () => {
    for (const group of WP_COLLATIONS) {
      for (const c of group.options) {
        expect(collationToEncoding(c.value)).toBe(group.bucket);
      }
    }
  });

  it('exposes the common WP defaults', () => {
    const all = WP_COLLATIONS.flatMap((g) => g.options.map((o) => o.value));
    expect(all).toContain('utf8mb4_unicode_ci');
    expect(all).toContain('latin1_swedish_ci');
  });
});
