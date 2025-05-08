import { stat, readFile, readdir } from 'fs/promises';
import { ModuleSource } from './downloader';
import path from 'path';
import Logging from '../interfaces/logging/beta';

export type AntelopeModuleSourceConfig = ({ version: string } | { source: ModuleSource }) & {
  config?: any;
  importOverrides?:
    | Array<{
        interface: string;
        source: string;
      }>
    | Record<string, string>;
  disabledExports?: Array<string>;
};

export interface AntelopeLogging {
  enabled: boolean;
  moduleTracking: { enabled: boolean; includes: string[]; excludes: string[] };
  formatter?: Record<string, string>;
  dateFormat?: string;
}

export interface AntelopeProjectEnvConfig {
  cacheFolder?: string;

  modules?: Record<string, string | AntelopeModuleSourceConfig>;

  logging?: AntelopeLogging;

  envOverrides?: Record<string, string>;
}

export interface AntelopeProjectEnvConfigStrict {
  cacheFolder: string;
  modules: Record<
    string,
    {
      source: ModuleSource;
      config: any;
      importOverrides: Array<{ interface: string; source: string; id?: string }>;
      disabledExports: Array<string>;
    }
  >;
  logging?: AntelopeLogging;
  envOverrides: Record<string, string>;
  disabledExports: Array<string>;
}

export interface AntelopeProjectRootConfig {
  name: string;
  version: string;
  description: string;
  author: string;

  environments?: Record<string, AntelopeProjectEnvConfig>;
}

export type AntelopeConfig = AntelopeProjectRootConfig & AntelopeProjectEnvConfig;

async function readConfigFile(configFile: string): Promise<any> {
  const st = await stat(configFile).catch(() => {});
  if (!st || !st.isFile()) return;
  return JSON.parse((await readFile(configFile)).toString());
}

function expandModules(modules: Record<string, AntelopeModuleSourceConfig | string>) {
  for (const name in modules) {
    const val = modules[name];
    if (typeof val === 'string') {
      modules[name] = {
        source: {
          type: 'package',
          package: name,
          version: val,
        } as ModuleSource,
        config: {},
        importOverrides: [],
        disabledExports: [],
      };
    } else {
      if (val.importOverrides && !Array.isArray(val.importOverrides)) {
        val.importOverrides = Object.entries(val.importOverrides).map(([interface_name, source]) => ({
          interface: interface_name,
          source,
        }));
      }
      if ('version' in val) {
        modules[name] = {
          source: {
            type: 'package',
            package: name,
            version: val.version,
          } as ModuleSource,
          config: val.config ?? {},
          importOverrides: val.importOverrides ?? [],
          disabledExports: val.disabledExports ?? [],
        };
      } else {
        val.config = val.config ?? {};
        val.importOverrides = val.importOverrides ?? [];
        val.disabledExports = val.disabledExports ?? [];
      }
    }
  }
}

function recursiveMerge(target: Record<any, any>, source: Record<any, any>) {
  for (const key in source) {
    const sVal = source[key];
    if (key in target) {
      const tVal = target[key];
      if (typeof tVal === 'object' && typeof sVal === 'object') {
        if (Array.isArray(tVal) && Array.isArray(sVal)) {
          // TODO: explicit merge behavior
          // tVal.push(...sVal);
          target[key] = sVal;
        } else {
          recursiveMerge(tVal, sVal);
        }
      } else {
        target[key] = sVal;
      }
    } else {
      target[key] = sVal;
    }
  }
}

function runTemplateString(match: string, expr: string, argnames: string[], argvalues: any[]) {
  try {
    try {
      return Function(...argnames, 'return ' + expr)(...argvalues);
    } catch (e: any) {
      if (!e.toString().startsWith('SyntaxError:')) {
        return match;
      }
    }
    return Function(...argnames, expr)(...argvalues);
  } catch (e) {
    console.error(e);
    return match;
  }
}

function processTemplates(object: Record<string, any>, argnames: string[], argvalues: any[]) {
  for (const key of Object.keys(object)) {
    const value = object[key];
    if (typeof value === 'string') {
      if (value.match(/^\$\{([^}]+)\}$/)) {
        object[key] = runTemplateString(value, value.substring(2, value.length - 1), argnames, argvalues);
      } else {
        object[key] = value.replace(/\$\{([^}]+)\}/g, (match, expr) =>
          runTemplateString(match, expr, argnames, argvalues),
        );
      }
    } else if (typeof value === 'object') {
      processTemplates(value, argnames, argvalues);
    }
  }
}

export async function LoadConfig(antelopeFolder: string, env: string): Promise<AntelopeProjectEnvConfigStrict> {
  const mainConfig = (await readConfigFile(path.join(antelopeFolder, 'antelope.json'))) as AntelopeConfig;

  const result = {
    cacheFolder: mainConfig.cacheFolder ?? '.antelope/cache',
    modules: mainConfig.modules ?? {},
    logging: mainConfig.logging ?? undefined,
    envOverrides: mainConfig.envOverrides ?? {},
  };
  expandModules(result.modules);

  const fileList = await readdir(antelopeFolder);
  for (const fileName of fileList) {
    const m = fileName.match(/^antelope\.(.*)\.json$/);
    if (m) {
      const moduleConfig = await readConfigFile(path.join(antelopeFolder, fileName));
      if (moduleConfig) {
        result.modules[m[1]] = result.modules[m[1]] ?? { config: {} };
        recursiveMerge((<AntelopeModuleSourceConfig>result.modules[m[1]]).config, moduleConfig);
      }
    }
  }

  if (env && env !== 'default' && mainConfig.environments && env in mainConfig.environments) {
    const envConfig = mainConfig.environments[env];
    recursiveMerge(result, envConfig);
    expandModules(result.modules);
  }

  for (const eVar in result.envOverrides) {
    if (eVar in process.env) {
      try {
        const keys = result.envOverrides[eVar].split('.');
        let tmp = result as any;
        for (let i = 0; i < keys.length - 1; ++i) {
          tmp = tmp[keys[i]] = tmp[keys[i]] ?? {};
        }
        tmp[keys[keys.length - 1]] = process.env[eVar];
      } catch (err) {
        Logging.Warn(`Failed to override config variable ${eVar}`, err);
      }
    }
  }

  processTemplates(
    result,
    ...Object.entries(result).reduce(
      (prev, [key, value]) => {
        prev[0].push(key);
        prev[1].push(value);
        return prev;
      },
      [[], []] as [string[], any[]],
    ),
  );

  return result as AntelopeProjectEnvConfigStrict;
}
