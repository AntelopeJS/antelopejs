/** A value `JSON.stringify` writes out unchanged; `undefined` members are dropped by it. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };
