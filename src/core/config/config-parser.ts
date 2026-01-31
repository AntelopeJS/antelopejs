import { AntelopeModuleConfig, ModuleSourcePackage } from '../../types';
import { set, isObject } from '../../utils/object';

export interface ExpandedModuleConfig {
  source: import('../../types').ModuleSource;
  config: unknown;
  importOverrides: Array<{ interface: string; source: string; id?: string }>;
  disabledExports: string[];
}

export class ConfigParser {
  processTemplates<T extends Record<string, any>>(config: T): T {
    const flatValues = this.flattenConfig(config);
    return this.processObject(config, flatValues) as T;
  }

  private flattenConfig(obj: Record<string, any>, prefix = ''): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        result[key] = String(value);
        result[fullKey] = String(value);
      } else if (isObject(value)) {
        Object.assign(result, this.flattenConfig(value, fullKey));
      }
    }

    return result;
  }

  private processObject(obj: any, values: Record<string, string>): any {
    if (typeof obj === 'string') {
      return this.processString(obj, values);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.processObject(item, values));
    }

    if (isObject(obj)) {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.processObject(value, values);
      }
      return result;
    }

    return obj;
  }

  private processString(str: string, values: Record<string, string>): string | any {
    const pureMatch = str.match(/^\$\{([^}]+)\}$/);
    if (pureMatch) {
      const key = pureMatch[1];
      if (key in values) {
        try {
          return JSON.parse(values[key]);
        } catch {
          return values[key];
        }
      }
      try {
        const fn = new Function(...Object.keys(values), `return ${key}`);
        return fn(...Object.values(values));
      } catch {
        return str;
      }
    }

    return str.replace(/\$\{([^}]+)\}/g, (_, key) => {
      return values[key] ?? '';
    });
  }

  applyEnvOverrides<T extends Record<string, any>>(
    config: T,
    overrides: Record<string, string | string[]>
  ): T {
    const result = JSON.parse(JSON.stringify(config));

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

  expandModuleShorthand(
    modules: Record<string, string | AntelopeModuleConfig>
  ): Record<string, ExpandedModuleConfig> {
    const result: Record<string, ExpandedModuleConfig> = {};

    for (const [name, config] of Object.entries(modules)) {
      if (typeof config === 'string') {
        result[name] = {
          source: { type: 'package', package: name, version: config } as ModuleSourcePackage,
          config: {},
          importOverrides: [],
          disabledExports: [],
        };
      } else {
        let source = config.source;
        if (!source && config.version) {
          source = { type: 'package', package: name, version: config.version } as ModuleSourcePackage;
        }

        let importOverrides: Array<{ interface: string; source: string; id?: string }> = [];
        if (config.importOverrides) {
          if (Array.isArray(config.importOverrides)) {
            importOverrides = config.importOverrides;
          } else {
            importOverrides = Object.entries(config.importOverrides).map(([iface, src]) => ({
              interface: iface,
              source: src,
            }));
          }
        }

        result[name] = {
          source: source!,
          config: config.config ?? {},
          importOverrides,
          disabledExports: config.disabledExports ?? [],
        };
      }
    }

    return result;
  }
}
