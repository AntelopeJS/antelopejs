import { isPlainObject } from "./object";
import { isBoolean, isNumber, isString } from "./type-guards";

/** A value `JSON.parse` can return. */
export type ParsedJson =
  | null
  | boolean
  | number
  | string
  | ParsedJson[]
  | { [key: string]: ParsedJson };

/**
 * Whether `value` is a {@link ParsedJson} at every depth: each array element,
 * a hole included, and each own enumerable value of a plain object. An
 * infinity is one, since `JSON.parse` reads `1e999` as `Infinity`. `NaN`, a
 * function, `undefined`, a symbol, a bigint, a `Date`, a `Map` or any other
 * class instance is not.
 */
export function isParsedJson(value: unknown): value is ParsedJson {
  if (
    value === null ||
    isString(value) ||
    (isNumber(value) && !Number.isNaN(value)) ||
    isBoolean(value)
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return [...items].every((item) => isParsedJson(item));
  }
  return (
    isPlainObject(value) &&
    Object.values(value).every((item) => isParsedJson(item))
  );
}
