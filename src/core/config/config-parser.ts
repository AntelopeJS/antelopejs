import type {
  AntelopeConfig,
  AntelopeModuleConfig,
  ImportOverride,
  ModuleSource,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import type { ModuleEntryConfig } from "./module-entry";

import {
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

export class ConfigParser {
  /**
   * Replaces `${key}` templates in every string of `config`. A pure template
   * whose value parses as JSON takes the parsed value, so a leaf can change
   * type: the result is `unknown` until a caller checks the fields it reads.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- takes the project fields with their module config, user JS data of any shape, and a pure template can retype any leaf, so the loader decodes the result in config-fields.ts
  processTemplates(config: unknown): unknown {
    const flatValues = this.flattenConfig(config);
    return this.processObject(config, flatValues);
  }

  private flattenConfig(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- walks the project fields with their module config, user JS data of any shape, collecting text, number and boolean leaves
    value: unknown,
    prefix = "",
    result = new Map<string, string>(),
  ) {
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

  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- rewrites the string leaves of user JS config data of any shape, and a pure template can turn a leaf into any JSON value
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
   * A copy of `config` with each overridden path set to its environment
   * variable's text, as `readOverride` decodes it for that path. A path can
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
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- an override path can reach and retype any field, so the loader decodes the copy in config-fields.ts
  ): unknown {
    const result = this.cloneValue(config);
    if (!isObject(result)) {
      return result;
    }

    for (const [envVar, paths] of Object.entries(overrides)) {
      const value = process.env[envVar];
      if (value === undefined) continue;

      const pathList = Array.isArray(paths) ? paths : [paths];
      for (const path of pathList) {
        set(result, path, readOverride(path, value));
      }
    }

    return result;
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- copies user JS config data of any shape, keeping RegExp, functions and class instances by identity
  private cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      const items: unknown[] = value;
      return items.map((item) => this.cloneValue(item));
    }

    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          this.cloneValue(item),
        ]),
      );
    }

    return value;
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

        let importOverrides: ImportOverride[] = [];
        if (config.importOverrides) {
          if (Array.isArray(config.importOverrides)) {
            importOverrides = config.importOverrides;
          } else {
            importOverrides = Object.entries(config.importOverrides).map(
              ([iface, src]) => ({
                interface: iface,
                source: src,
              }),
            );
          }
        }

        const expanded: ExpandedModuleConfig = {
          source: source!,
          config: config.config ?? {},
          importOverrides,
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
