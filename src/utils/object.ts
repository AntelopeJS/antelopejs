import { isDeepStrictEqual } from "node:util";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Exported object detection promises no property schema; its open-dictionary predicate must stay unchanged.
export function isObject(item: unknown): item is Record<string, unknown> {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The exported object predicate must distinguish non-array objects from functions and primitives; narrowing its accepted boundary changes its contract.
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
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Exported plain-object detection promises no leaf schema; narrowing this predicate changes declarations.
export function isPlainObject(item: unknown): item is Record<string, unknown> {
  if (!isObject(item)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(item);
  return prototype === Object.prototype || prototype === null;
}

export function mergeDeep(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Exported merge accepts application-owned keys and values; tightening its dictionary changes declarations and callers.
  target: Record<string, any>,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Exported merge sources deliberately allow arbitrary leaf values and undefined sources.
  ...sources: Array<Record<string, any> | undefined>
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

function changedEntries(
  key: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- diffDeep compares arbitrary leaf values accepted by its exported open dictionaries, including class instances.
  before: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The replacement leaf may be any JavaScript value; parsing would change deep-equality and identity behavior.
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
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Exported diff input permits arbitrary application leaf values; narrowing changes its declaration.
  before: Record<string, any>,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Exported replacement dictionaries permit arbitrary application leaf values and must remain open.
  after: Record<string, any>,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Exported diff preserves arbitrary changed leaves; assigning a concrete schema would misrepresent accepted values.
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(after).flatMap(([key, value]) =>
      changedEntries(key, before[key], value),
    ),
  );
}

export function set(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Exported path assignment accepts arbitrary application dictionaries; tightening this type changes callers and declarations.
  obj: Record<string, any>,
  path: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Exported path assignment stores arbitrary values without validation or conversion.
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
