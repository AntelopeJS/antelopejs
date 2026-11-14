import type {
  AntelopeConfig,
  AntelopeModuleConfig,
  ImportOverride,
  ModuleSource,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import type { ModuleEntryConfig } from "./module-entry";

import {
  cloneValue,
  isObject,
  isPlainObject,
  set,
  isBoolean,
  isNumber,
  isObjectOrNull,
  isString,
} from "../../utils";
import { isConfigVarKey } from "./config-vars";

/** A project configuration with its module shorthands expanded. */
export interface ProjectConfig extends Omit<AntelopeConfig, "modules"> {
  modules: Record<string, ExpandedModuleConfig>;
}

export interface ExpandedModuleConfig {
  source: ModuleSource;
  config: unknown;
  importOverrides: ImportOverride[];
  disabledExports: string[];
  exportPriority?: Record<string, number>;
  /** Loaded after the other modules, its failure logged and tolerated. */
  optional?: boolean;
}

function readExportPriority(name: string, priorities: Record<string, number>) {
  for (const [interfaceName, priority] of Object.entries(priorities)) {
    if (!Number.isInteger(priority)) {
      throw new Error(
        `Module '${name}' gives '${interfaceName}' the export priority ${String(priority)}; priorities are integers.`,
      );
    }
  }
  return { ...priorities };
}

/**
 * The list form of a module entry's `importOverrides`: a map of interface
 * names to module names becomes one override per interface, and a missing
 * field an empty list.
 */
export function expandImportOverrides(
  importOverrides: AntelopeModuleConfig["importOverrides"],
): ImportOverride[] {
  if (!importOverrides) {
    return [];
  }
  if (Array.isArray(importOverrides)) {
    return importOverrides;
  }
  return Object.entries(importOverrides).map(([iface, src]) => ({
    interface: iface,
    source: src,
  }));
}

/**
 * Reads the text an `envOverrides` variable gives the configuration path it
 * maps, or `undefined` to leave that path as configured.
 */
export type OverrideReader = (name: string, path: string) => string | undefined;

/** Reads every override from the process environment. */
export const readProcessEnv: OverrideReader = (name) => process.env[name];

export class ConfigParser {
  /**
   * Replaces `${key}` templates in every string of `config`. A pure template
   * whose value parses as JSON takes the parsed value, so a leaf can change
   * type: the result is `unknown` until a caller checks the fields it reads.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- takes the project fields with their module config, any JS value (docs/2.concepts/4.configuration.md, Referencing), and returns them through processObject, which rebuilds every array and plain object, can turn a string leaf into any JSON value, and returns every other value, such as a RegExp, a Date or a class instance, by identity; the loader decodes the result in config-fields.ts
  processTemplates(config: unknown): unknown {
    const flatValues = this.flattenConfig(config);
    return this.processObject(config, flatValues);
  }

  private flattenConfig(
    value: unknown,
    prefix = "",
    result = new Map<string, string>(),
  ): Map<string, string> {
    if (!isObject(value)) {
      return result;
    }
    for (const [key, item] of Object.entries(value)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (isString(item) || isNumber(item) || isBoolean(item)) {
        result.set(key, String(item));
        result.set(fullKey, String(item));
      } else if (isObject(item)) {
        this.flattenConfig(item, fullKey, result);
      }
    }

    return result;
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- rewrites the string templates of the project fields, whose module config is any JS value (docs/2.concepts/4.configuration.md, Referencing): rebuilds every array and plain object, turns a pure template into any JSON value, and returns every other value, such as a RegExp, a Date or a class instance, by identity
  private processObject(value: unknown, values: Map<string, string>): unknown {
    if (isString(value)) {
      const pureMatch = value.match(/^\$\{([^}]+)\}$/);
      if (!pureMatch) {
        return value.replace(/\$\{([^}]+)\}/g, (token: string, key: string) =>
          isConfigVarKey(key) ? token : (values.get(key) ?? ""),
        );
      }
      const key = pureMatch[1];
      const text = isConfigVarKey(key) ? undefined : values.get(key);
      if (text === undefined) {
        return value;
      }
      try {
        const parsed: unknown = JSON.parse(text);
        return parsed;
      } catch {
        return text;
      }
    }

    if (Array.isArray(value)) {
      const items: unknown[] = value;
      return items.map((item) => this.processObject(item, values));
    }

    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          this.processObject(item, values),
        ]),
      );
    }

    return value;
  }

  /**
   * A copy of `config` with each overridden path set to the text `variables`
   * reads for it, as `readOverride` decodes it for that path. A path can
   * reach any field, so the result is `unknown` until a caller checks the
   * fields it reads.
   */
  applyEnvOverrides(
    config: ProjectConfig,
    overrides: Record<string, string | string[]>,
    readOverride: (path: string, text: string) => string | number | boolean = (
      _path,
      text,
    ) => text,
    variables: OverrideReader = readProcessEnv,
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- an override path can reach and retype any field, so the loader decodes the copy in config-fields.ts
  ): unknown {
    const result = cloneValue(config);
    if (!isObject(result)) {
      return result;
    }

    for (const [envVar, paths] of Object.entries(overrides)) {
      const pathList = Array.isArray(paths) ? paths : [paths];
      for (const path of pathList) {
        const value = variables(envVar, path);
        if (value !== undefined) {
          set(result, path, readOverride(path, value));
        }
      }
    }

    return result;
  }

  expandModuleShorthand(
    modules: Record<string, string | AntelopeModuleConfig>,
  ) {
    const result: Record<string, ExpandedModuleConfig> = {};

    for (const [name, entry] of Object.entries(modules)) {
      const config: string | ModuleEntryConfig = entry;
      if (isObjectOrNull(config) && config.disabled) {
        continue;
      }
      if (isString(config)) {
        const source = {
          type: "package",
          package: name,
          version: config,
        } satisfies ModuleSourcePackage;
        result[name] = {
          source,
          config: {},
          importOverrides: [],
          disabledExports: [],
        };
      } else {
        let source = config.source;
        if (!source && config.version) {
          source = {
            type: "package",
            package: name,
            version: config.version,
          } satisfies ModuleSourcePackage;
        }

        const expanded: ExpandedModuleConfig = {
          source: source!,
          config: config.config ?? {},
          importOverrides: expandImportOverrides(config.importOverrides),
          disabledExports: config.disabledExports ?? [],
        };
        result[name] = expanded;
        if (config.optional) {
          expanded.optional = true;
        }
        if (config.exportPriority) {
          expanded.exportPriority = readExportPriority(
            name,
            config.exportPriority,
          );
        }
      }
    }

    return result;
  }
}
