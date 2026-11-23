/** Returns `value`, or throws when it is `null` or `undefined`, so the caller sees the narrowed type. */
export function defined<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) {
    throw new Error(`${what} is not defined`);
  }
  return value;
}
