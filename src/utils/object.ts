import { isObjectOrNull } from "./type-guards";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- its two users hold records whose values are any JS value: diffConfig in src/cli/config-source.ts compares the evaluated antelope.config.ts with the config a command writes back, whose module config is any JS value (docs/2.concepts/4.configuration.md, Referencing), and definedFields in src/core/test/test-module.ts drops the undefined fields of what a test.setup hook returns before assertLoadedConfig decodes them
export type UnknownDictionary = Record<string, unknown>;

export function isObject(item: unknown): item is Record<string, unknown> {
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
export function isPlainObject(item: unknown): item is Record<string, unknown> {
  if (!isObject(item)) {
    return false;
  }
  const prototype = Reflect.getPrototypeOf(item);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A deep copy of `value`: arrays and plain objects are rebuilt, and every other
 * value, such as a RegExp, a function or a class instance, is kept by identity.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- copies a project config whose module config is any JS value (docs/2.concepts/4.configuration.md, Referencing): rebuilds arrays and plain objects, and returns every other value, such as a RegExp, a Date, a function or a class instance, by identity
export function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return items.map((item) => cloneValue(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
    );
  }

  return value;
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

      Object.defineProperty(result, key, {
        value:
          isObject(sourceValue) && isObject(targetValue)
            ? mergeDeep(targetValue, sourceValue)
            : sourceValue,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }

  return result;
}

type ObjectEntry = [string, unknown];

function assignKey(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- writes into an object on an applyEnvOverrides path: a plain object of the copy cloneValue made, an empty object set creates for a missing segment, or any other object of a module config, any JS value (docs/2.concepts/4.configuration.md, Referencing), such as a class instance or a RegExp, which cloneValue keeps by identity, so that write goes through its setters into the user's own object
  target: Record<string, unknown>,
  key: string,
  value: string | number | boolean | Record<string, never>,
): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}

export function set(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- its one caller, applyEnvOverrides, passes its project config copy, whose module config is any JS value (docs/2.concepts/4.configuration.md, Referencing): set descends into any non-array object on the path, a class instance or a RegExp included, and assigns through its setters
  obj: Record<string, unknown>,
  path: string,
  value: string | number | boolean,
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
      const created = {};
      assignKey(current, key, created);
      current = created;
    }
  }

  assignKey(current, keys[keys.length - 1], value);
}
