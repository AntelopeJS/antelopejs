import type { ConfigVarValue } from "@antelopejs/interface-core/config";

import { isPlainObject } from "../../utils/object";

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

  visitStrings(config, (value) => {
    for (const reference of matchReferences(value)) {
      references.set(reference.token, reference);
    }
    for (const token of value.match(RESERVED_TOKEN_PATTERN) ?? []) {
      if (!references.has(token)) {
        malformed.add(token);
      }
    }
  });

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
  config: unknown,
  lookup: ConfigVarLookup,
): unknown {
  if (typeof config === "string") {
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
  config: Record<string, unknown>,
  lookup: ConfigVarLookup,
): Record<string, unknown> {
  const entries = Object.entries(config).map(
    ([key, value]) => [key, substituteConfigVars(value, lookup)] as const,
  );
  const changed = entries.some(([key, value]) => value !== config[key]);
  return changed ? Object.fromEntries(entries) : config;
}

function substituteString(value: string, lookup: ConfigVarLookup): unknown {
  const pure = value.match(PURE_REFERENCE_PATTERN);
  if (pure) {
    return lookup({ token: value, module: pure[1], variable: pure[2] });
  }

  return value.replace(REFERENCE_PATTERN, (token, module, variable) =>
    String(lookup({ token, module, variable })),
  );
}

function matchReferences(value: string): ConfigVarReference[] {
  return [...value.matchAll(REFERENCE_PATTERN)].map(
    ([token, module, variable]) => ({ token, module, variable }),
  );
}

function visitStrings(value: unknown, visit: (value: string) => void): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => visitStrings(item, visit));
    return;
  }

  if (isPlainObject(value)) {
    Object.values(value).forEach((item) => visitStrings(item, visit));
  }
}
