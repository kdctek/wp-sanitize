export type PhpKey =
  | { kind: 'int'; value: number | bigint }
  | { kind: 'string'; value: string };

export type PhpValue =
  | { kind: 'null' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'int'; value: number | bigint }
  | { kind: 'float'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'array'; entries: Array<[PhpKey, PhpValue]> }
  | { kind: 'object'; className: string; entries: Array<[PhpKey, PhpValue]> }
  | { kind: 'ref'; target: number; isObjectRef: boolean };

export class PhpSerializeError extends Error {
  constructor(message: string, public byteOffset?: number) {
    super(byteOffset !== undefined ? `${message} (at byte ${byteOffset})` : message);
    this.name = 'PhpSerializeError';
  }
}
