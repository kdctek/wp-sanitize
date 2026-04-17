export interface Example {
  label: string;
  description: string;
  serialized: string;
}

export const EXAMPLES: Example[] = [
  {
    label: 'Simple associative array',
    description: 'name + age — the canonical starter example.',
    serialized: 'a:2:{s:4:"name";s:5:"Kevin";s:3:"age";i:42;}',
  },
  {
    label: 'Nested array (tags)',
    description: 'A post-like blob with a title, count, and list of tags.',
    serialized:
      'a:3:{s:5:"title";s:11:"Hello World";s:5:"count";i:7;s:4:"tags";a:2:{i:0;s:3:"foo";i:1;s:3:"bar";}}',
  },
  {
    label: 'UTF-8 strings',
    description: 'Byte-length handling for accented characters and emoji.',
    serialized: 'a:2:{s:6:"coffee";s:9:"café ☕";s:5:"thumb";s:4:"👍";}',
  },
  {
    label: 'Widget-block option',
    description: 'Shape of a wp_options row for a block widget.',
    serialized:
      'a:1:{s:13:"widget_block1";a:1:{s:7:"content";s:30:"<!-- wp:paragraph --><p>hi</p>";}}',
  },
  {
    label: 'Primitives',
    description: 'null, bool, int, float — all the scalar kinds.',
    serialized: 'a:4:{s:1:"n";N;s:1:"b";b:1;s:1:"i";i:-99;s:1:"f";d:3.14;}',
  },
  {
    label: 'stdClass object',
    description: 'A PHP object with a class name.',
    serialized: 'O:8:"stdClass":2:{s:1:"x";i:1;s:1:"y";i:2;}',
  },
];
