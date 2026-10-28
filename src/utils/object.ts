import { isDeepStrictEqual } from "node:util";
import { isObjectOrNull } from "./type-guards";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Application config and logging dictionaries carry caller-owned keys and leaf values of every kind, so the merge, diff and path-assignment helpers can only treat the leaves as open.
type OpenDictionary = Record<string, any>;

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The result of a plain-object guard: its keys are known to be strings and its leaves are what the guard's caller goes on to decode.
type UnknownDictionary = Record<string, unknown>;

export function isObject(item: unknown): item is UnknownDictionary {
  return isObjectOrNull(item) && item !== null && !Array.isArray(item);
}

/**
 * Whether a value is a plain object, safe to rebuild key by key.
 *
 * A `RegExp`, a `Date`, a `Map`, a `Buffer` or any class instance carries
 * state no enumerable key exposes: rebuilding one from its entries returns an
 * empty husk. Configuration holds such values, so every traversal that clones
 * has to tell them apart from the object literals it may safely copy.
 */
export function isPlainObject(item: unknown): item is UnknownDictionary {
  if (!isObject(item)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(item);
  return prototype === Object.prototype || prototype === null;
}

export function mergeDeep(
  target: OpenDictionary,
  ...sources: Array<OpenDictionary | undefined>
) {
  const result: typeof target = { ...target };

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

/**
 * The keys of `after` whose value differs from `before`, nested plain objects
 * reduced to their own differing keys. Merging the result into `before` with
 * {@link mergeDeep} yields `after`, as long as no key was removed.
 */
export function diffDeep(
  before: OpenDictionary,
  after: OpenDictionary,
): UnknownDictionary {
  return Object.fromEntries(
    Object.entries(after).flatMap(([key, value]): ObjectEntry[] => {
      const previous = before[key];
      if (isPlainObject(previous) && isPlainObject(value)) {
        const nested = diffDeep(previous, value);
        return Object.keys(nested).length > 0 ? [[key, nested]] : [];
      }
      return isDeepStrictEqual(previous, value) ? [] : [[key, value]];
    }),
  );
}

export function set(
  obj: OpenDictionary,
  path: string,
  value: OpenDictionary[string],
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
