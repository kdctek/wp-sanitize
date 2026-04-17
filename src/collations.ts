export type CharsetBucket = 'utf8' | 'latin1';

export interface CollationOption {
  value: string;
  label: string;
  title: string;
}

export interface CollationGroup {
  charset: string;
  bucket: CharsetBucket;
  options: CollationOption[];
}

const opt = (value: string, title: string): CollationOption => ({
  value,
  label: value,
  title,
});

export const WP_COLLATIONS: CollationGroup[] = [
  {
    charset: 'utf8mb4',
    bucket: 'utf8',
    options: [
      opt('utf8mb4_general_ci', 'Unicode (UCA 4.0.0), case-insensitive'),
      opt('utf8mb4_unicode_ci', 'Unicode (UCA 4.0.0), case-insensitive'),
      opt('utf8mb4_unicode_520_ci', 'Unicode (UCA 5.2.0), case-insensitive'),
      opt('utf8mb4_0900_ai_ci', 'Unicode (UCA 9.0.0), accent-insensitive, case-insensitive'),
      opt('utf8mb4_bin', 'Unicode, binary'),
    ],
  },
  {
    charset: 'utf8mb3',
    bucket: 'utf8',
    options: [
      opt('utf8mb3_general_ci', 'Unicode, case-insensitive'),
      opt('utf8mb3_unicode_ci', 'Unicode (UCA 4.0.0), case-insensitive'),
      opt('utf8mb3_bin', 'Unicode, binary'),
    ],
  },
  {
    charset: 'utf8',
    bucket: 'utf8',
    options: [
      opt('utf8_general_ci', 'Unicode, case-insensitive'),
      opt('utf8_unicode_ci', 'Unicode (UCA 4.0.0), case-insensitive'),
      opt('utf8_bin', 'Unicode, binary'),
    ],
  },
  {
    charset: 'latin1',
    bucket: 'latin1',
    options: [
      opt('latin1_swedish_ci', 'Swedish, case-insensitive'),
      opt('latin1_general_ci', 'West European, case-insensitive'),
      opt('latin1_general_cs', 'West European, case-sensitive'),
      opt('latin1_bin', 'West European, binary'),
    ],
  },
  {
    charset: 'ascii',
    bucket: 'latin1',
    options: [
      opt('ascii_general_ci', 'West European, case-insensitive'),
      opt('ascii_bin', 'West European, binary'),
    ],
  },
];

export function collationToEncoding(value: string): CharsetBucket {
  return value.startsWith('utf8') ? 'utf8' : 'latin1';
}
