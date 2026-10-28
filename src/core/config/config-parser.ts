import type {
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
  processTemplates<T extends Record<string, any>>(config: T): T {
    const flatValues = this.flattenConfig(config);
    return this.processObject(config, flatValues);
  }

  private flattenConfig(
    obj: Parameters<ConfigParser["processTemplates"]>[0],
    prefix = "",
  ) {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (isString(value) || isNumber(value) || isBoolean(value)) {
        result[key] = String(value);
        result[fullKey] = String(value);
      } else if (isObject(value)) {
        Object.assign(result, this.flattenConfig(value, fullKey));
      }
    }

    return result;
  }

  private processObject(obj: any, values: Record<string, string>): any {
    if (isString(obj)) {
      return this.processString(obj, values);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.processObject(item, values));
    }

    if (isPlainObject(obj)) {
      const result: Parameters<ConfigParser["processTemplates"]>[0] = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.processObject(value, values);
      }
      return result;
    }

    return obj;
  }

  private processString(str: string, values: Record<string, string>): any {
    const pureMatch = str.match(/^\$\{([^}]+)\}$/);
    if (pureMatch) {
      const key = pureMatch[1];
      if (isConfigVarKey(key)) {
        return str;
      }
      if (key in values) {
        try {
          return JSON.parse(values[key]);
        } catch {
          return values[key];
        }
      }
      return str;
    }

    return str.replace(/\$\{([^}]+)\}/g, (token, key) => {
      if (isConfigVarKey(key)) {
        return token;
      }
      return values[key] ?? "";
    });
  }

  applyEnvOverrides<T extends Record<string, any>>(
    config: T,
    overrides: Record<string, string | string[]>,
  ): T {
    const result = this.cloneValue(config);

    for (const [envVar, paths] of Object.entries(overrides)) {
      const value = process.env[envVar];
      if (value === undefined) continue;

      const pathList = Array.isArray(paths) ? paths : [paths];
      for (const path of pathList) {
        set(result, path, value);
      }
    }

    return result;
  }

  private cloneValue<T>(value: T): T {
    if (Array.isArray(value)) {
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Cloning discards array subclass properties; preserving the existing generic promise requires the same unchecked conversion as processTemplates (#226).
      return value.map((item) => this.cloneValue(item)) as T;
    }

    if (isPlainObject(value)) {
      const result: Parameters<ConfigParser["processTemplates"]>[0] = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = this.cloneValue(item);
      }
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Only enumerable string keys are cloned; T may also require symbols or nonenumerable members (#226).
      return result as T;
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

        result[name] = {
          source: source!,
          config: config.config ?? {},
          importOverrides,
          disabledExports: config.disabledExports ?? [],
        };
        if (config.optional) {
          result[name].optional = true;
        }
        if (config.exportPriority) {
          result[name].exportPriority = readExportPriority(
            name,
            config.exportPriority,
          );
        }
      }
    }

    return result;
  }
}
