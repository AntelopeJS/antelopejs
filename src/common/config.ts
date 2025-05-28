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

interface ConfigFile {
  config?: Record<string, unknown>;
  antelopeJs?: {
    config?: Record<string, unknown>;
  };
}

async function readConfigFile(configFile: string): Promise<unknown> {
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

async function loadConfigFile(filePath: string): Promise<ConfigFile | null> {
  try {
    if ((await stat(filePath)).isFile()) {
      Logging.inline.Info(`Found config file at ${filePath}`);
      const content = JSON.parse((await readFile(filePath)).toString()) as ConfigFile;
      Logging.inline.Info(`Content of config file: ${JSON.stringify(content)}`);
      return content;
    }
    Logging.inline.Info(`No config file found at ${filePath}`);
    return null;
  } catch (err) {
    Logging.Warn(`Failed to load config file from ${filePath}`, err);
    return null;
  }
}

export async function loadModuleConfig(
  modulePath: string,
): Promise<{ config: Record<string, unknown>; warnings: string[] }> {
  const warnings: string[] = [];
  let moduleConfig: ConfigFile = {};

  Logging.inline.Info(`Loading module config from ${modulePath}`);

  const moduleJsonContent = await loadConfigFile(path.join(modulePath, 'antelope.module.json'));
  const packageJsonContent = await loadConfigFile(path.join(modulePath, 'package.json'));

  if (moduleJsonContent && Object.keys(moduleJsonContent).length > 0) {
    moduleConfig = moduleJsonContent;
  } else if (packageJsonContent?.antelopeJs?.config && Object.keys(packageJsonContent.antelopeJs.config).length > 0) {
    moduleConfig = packageJsonContent;
  } else {
    warnings.push(`Module ${modulePath} has no config in antelope.module.json or package.json.`);
    return { config: {}, warnings };
  }

  if (
    moduleJsonContent &&
    Object.keys(moduleJsonContent).length > 0 &&
    packageJsonContent &&
    Object.keys(packageJsonContent).length > 0
  ) {
    warnings.push(
      `Module ${modulePath} has config in both files. Using both, with antelope.module.json taking precedence.`,
    );
  }

  recursiveMerge(moduleConfig, moduleConfig.antelopeJs?.config ?? {});

  return { config: moduleConfig.config || {}, warnings };
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

  // Load module configurations
  for (const [_, moduleConfig] of Object.entries(result.modules)) {
    if (typeof moduleConfig === 'object' && 'source' in moduleConfig) {
      const source = moduleConfig.source as ModuleSource & { path?: string };
      if (source.type === 'local' && source.path) {
        const modulePath = path.join(antelopeFolder, source.path);
        const { config, warnings } = await loadModuleConfig(modulePath);
        warnings.forEach((warning) => Logging.Warn(warning));
        if (Object.keys(config).length > 0) {
          recursiveMerge((moduleConfig as AntelopeModuleSourceConfig).config, config);
        }
      }
    }
  }

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

  recursiveMerge(result, mainConfig);

  return result as AntelopeProjectEnvConfigStrict;
}
