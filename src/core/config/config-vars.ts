import type { ConfigVarValue } from "@antelopejs/interface-core/config";

import { isPlainObject, isString } from "../../utils";

const RESERVED_PREFIX = "@";
const REFERENCE_PATTERN = /\$\{@([^{}]+)\.([A-Za-z_][A-Za-z0-9_]*)\}/g;
const PURE_REFERENCE_PATTERN = /^\$\{@([^{}]+)\.([A-Za-z_][A-Za-z0-9_]*)\}$/;
const RESERVED_TOKEN_PATTERN = /\$\{@[^{}]*\}/g;

export interface ConfigVarReference {
  token: string;
  module: string;
  variable: string;
}

export interface ConfigVarScan {
  references: ConfigVarReference[];
  malformed: string[];
}

interface ConfigVarManifest {
  antelopeJs?: {
    configVars?: string[];
  };
}

export type ConfigVarLookup = (reference: ConfigVarReference) => ConfigVarValue;

/** Whether a template key belongs to the config variable namespace. */
export function isConfigVarKey(key: string): boolean {
  return key.startsWith(RESERVED_PREFIX);
}

/** The config variable names a module declares in its manifest. */
export function declaredConfigVars(source?: {
  manifest?: ConfigVarManifest;
}): string[] {
  const declared = source?.manifest?.antelopeJs?.configVars;
  return Array.isArray(declared) ? [...declared] : [];
}

/** Every config variable reference a configuration holds, at any depth. */
export function scanConfigVars(config: unknown): ConfigVarScan {
  const references = new Map<string, ConfigVarReference>();
  const malformed = new Set<string>();

  for (const value of stringsIn(config, [])) {
    for (const reference of matchReferences(value)) {
      references.set(reference.token, reference);
    }
    for (const token of value.match(RESERVED_TOKEN_PATTERN) ?? []) {
      if (!references.has(token)) {
        malformed.add(token);
      }
    }
  }

  return { references: [...references.values()], malformed: [...malformed] };
}

/**
 * The configuration with every config variable reference replaced.
 *
 * Only the branches that actually hold a reference are rebuilt: everything
 * else, values the traversal cannot clone without losing them included, comes
 * back by identity. A configuration that holds no reference is returned as it
 * came in.
 */
export function substituteConfigVars(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- takes a module config, any JS value (docs/2.concepts/4.configuration.md, Referencing): substitutes its strings, rebuilds an array or a plain object only when a member changed, and returns every other value, such as a RegExp, a Date or a class instance, by identity
  config: unknown,
  lookup: ConfigVarLookup,
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- returns the module config it takes, any JS value (docs/2.concepts/4.configuration.md, Referencing), with its strings substituted, an array or a plain object rebuilt only when a member changed, and every other value, such as a RegExp, a Date or a class instance, by identity
): unknown {
  if (isString(config)) {
    return substituteString(config, lookup);
  }

  if (Array.isArray(config)) {
    return substituteArray(config, lookup);
  }

  if (isPlainObject(config)) {
    return substituteObject(config, lookup);
  }

  return config;
}

function substituteArray(
  config: unknown[],
  lookup: ConfigVarLookup,
): unknown[] {
  const items = config.map((item) => substituteConfigVars(item, lookup));
  const changed = items.some((item, index) => item !== config[index]);
  return changed ? items : config;
}

function substituteObject(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- takes a plain object of a module config, whose values are any JS value (docs/2.concepts/4.configuration.md, Referencing), and passes each through substituteConfigVars, which returns a RegExp, a Date or a class instance by identity
  config: Record<string, unknown>,
  lookup: ConfigVarLookup,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- returns the plain object it takes, whose values are any JS value (docs/2.concepts/4.configuration.md, Referencing), by identity when no value changed, or rebuilt with the changed values and every other value, such as a RegExp, a Date or a class instance, by identity
): Record<string, unknown> {
  const original = Object.entries(config);
  const entries = original.map(
    ([key, value]) => [key, substituteConfigVars(value, lookup)] as const,
  );
  const changed = entries.some(
    ([, value], index) => value !== original[index][1],
  );
  return changed ? Object.fromEntries(entries) : config;
}

function substituteString(
  value: string,
  lookup: ConfigVarLookup,
): ConfigVarValue {
  const pure = value.match(PURE_REFERENCE_PATTERN);
  if (pure) {
    return lookup({ token: value, module: pure[1], variable: pure[2] });
  }

  let substituted = "";
  let copiedUpTo = 0;
  for (const match of value.matchAll(REFERENCE_PATTERN)) {
    const [token, module, variable] = match;
    substituted += value.slice(copiedUpTo, match.index);
    substituted += String(lookup({ token, module, variable }));
    copiedUpTo = match.index + token.length;
  }
  return substituted + value.slice(copiedUpTo);
}

function matchReferences(value: string): ConfigVarReference[] {
  return [...value.matchAll(REFERENCE_PATTERN)].map(
    ([token, module, variable]) => ({ token, module, variable }),
  );
}

/** `found`, with the strings `value` holds in its arrays and plain objects pushed on, depth first. */
function stringsIn(value: unknown, found: string[]): string[] {
  if (isString(value)) {
    found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => {
      stringsIn(item, found);
    });
  } else if (isPlainObject(value)) {
    Object.values(value).forEach((item) => {
      stringsIn(item, found);
    });
  }
  return found;
}
