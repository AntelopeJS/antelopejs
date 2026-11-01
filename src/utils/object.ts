import { isDeepStrictEqual } from "node:util";
import { isObjectOrNull, isString } from "./type-guards";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The result of a plain-object guard: its keys are known to be strings and its leaves are what the guard's caller goes on to decode.
export type UnknownDictionary = Record<string, unknown>;

/** Whether a value is absent or a primitive string. */
export function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

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
  const prototype = Reflect.getPrototypeOf(item);
  return prototype === Object.prototype || prototype === null;
}

function ownDataProperty(value: UnknownDictionary[string]) {
  return {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  };
}

export function mergeDeep<T extends object>(
  target: T,
  ...sources: Array<Partial<T> | undefined>
): T {
  const result: T = { ...target };

  for (const source of sources) {
    if (!source) continue;
    const entries: ObjectEntry[] = Object.entries(source);
    for (const [key, sourceValue] of entries) {
      const targetValue: unknown = Object.getOwnPropertyDescriptor(
        result,
        key,
      )?.value;

      Object.defineProperty(
        result,
        key,
        ownDataProperty(
          isObject(sourceValue) && isObject(targetValue)
            ? mergeDeep(targetValue, sourceValue)
            : sourceValue,
        ),
      );
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
export function diffDeep<T extends object>(
  before: T,
  after: T,
): UnknownDictionary {
  const entries: ObjectEntry[] = Object.entries(after);
  return Object.fromEntries(
    entries.flatMap(([key, value]): ObjectEntry[] => {
      const previous: unknown = Object.getOwnPropertyDescriptor(
        before,
        key,
      )?.value;
      if (isPlainObject(previous) && isPlainObject(value)) {
        const nested = diffDeep(previous, value);
        return Object.keys(nested).length > 0 ? [[key, nested]] : [];
      }
      return isDeepStrictEqual(previous, value) ? [] : [[key, value]];
    }),
  );
}

function assignKey(
  target: UnknownDictionary,
  key: string,
  value: UnknownDictionary[string],
): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, ownDataProperty(value));
  } else {
    target[key] = value;
  }
}

export function set(
  obj: UnknownDictionary,
  path: string,
  value: UnknownDictionary[string],
): void {
  const keys = path.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const present =
      key === "__proto__" ? Object.hasOwn(current, key) : key in current;
    const existing = current[key];
    if (present && isObject(existing)) {
      current = existing;
    } else {
      const created: UnknownDictionary = {};
      assignKey(current, key, created);
      current = created;
    }
  }

  assignKey(current, keys[keys.length - 1], value);
}
