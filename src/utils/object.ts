import { isDeepStrictEqual } from "node:util";

export function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === "object" && !Array.isArray(item);
}

/**
 * Whether a value is a plain object, safe to rebuild key by key.
 *
 * A `RegExp`, a `Date`, a `Map`, a `Buffer` or any class instance carries
 * state no enumerable key exposes: rebuilding one from its entries returns an
 * empty husk. Configuration holds such values, so every traversal that clones
 * has to tell them apart from the object literals it may safely copy.
 */
export function isPlainObject(item: unknown): item is Record<string, unknown> {
  if (!isObject(item)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(item);
  return prototype === Object.prototype || prototype === null;
}

export function mergeDeep(
  target: Record<string, any>,
  ...sources: Array<Record<string, any> | undefined>
): Record<string, any> {
  const result: Record<string, any> = { ...target };

  for (const source of sources) {
    if (!source) continue;
    for (const key in source) {
      if (Object.hasOwn(source, key)) {
        const sourceValue = source[key];
        const targetValue = result[key];

        if (isObject(sourceValue) && isObject(targetValue)) {
          result[key] = mergeDeep(targetValue, sourceValue);
        } else {
          result[key] = sourceValue;
        }
      }
    }
  }

  return result;
}

type ObjectEntry = [string, unknown];

function changedEntries(
  key: string,
  before: unknown,
  after: unknown,
): ObjectEntry[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const nested = diffDeep(before, after);
    return Object.keys(nested).length > 0 ? [[key, nested]] : [];
  }
  return isDeepStrictEqual(before, after) ? [] : [[key, after]];
}

/**
 * The keys of `after` whose value differs from `before`, nested plain objects
 * reduced to their own differing keys. Merging the result into `before` with
 * {@link mergeDeep} yields `after`, as long as no key was removed.
 */
export function diffDeep(
  before: Record<string, any>,
  after: Record<string, any>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(after).flatMap(([key, value]) =>
      changedEntries(key, before[key], value),
    ),
  );
}

export function set(
  obj: Record<string, any>,
  path: string,
  value: unknown,
): void {
  const keys = path.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || !isObject(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}
