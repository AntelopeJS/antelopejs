import { createJiti } from 'jiti';
import { IFileSystem, AntelopeConfig, AntelopeLogging, AntelopeTestConfig } from '../../types';
import { ConfigParser, ExpandedModuleConfig } from './config-parser';
import { mergeDeep } from '../../utils/object';
import { ConfigInput } from '../../config';
import { DEFAULT_CACHE_DIR, DEFAULT_ENV, findConfigPath, getModuleConfigPath } from './config-paths';
import * as self from './config-loader';

export interface LoadedConfig {
  name: string;
  cacheFolder: string;
  modules: Record<string, ExpandedModuleConfig>;
  logging?: AntelopeLogging;
  envOverrides: Record<string, string | string[]>;
  test?: AntelopeTestConfig;
}

export async function loadTsConfigFile(configPath: string, environment?: string): Promise<AntelopeConfig> {
  const jiti = createJiti(configPath);
  const loaded = await jiti.import(configPath);
  const configInput: ConfigInput = (loaded as any).default ?? loaded;

  if (typeof configInput === 'function') {
    return await configInput({ env: environment ?? DEFAULT_ENV });
  }

  return configInput;
}

export class ConfigLoader {
  private parser = new ConfigParser();

  constructor(private fs: IFileSystem) {}

  async load(projectFolder: string, environment?: string, configPath?: string): Promise<LoadedConfig> {
    const rawConfig = await this.loadConfigSource(projectFolder, environment, configPath);

    let config = { ...rawConfig };
    if (environment && rawConfig.environments?.[environment]) {
      config = mergeDeep(config, rawConfig.environments[environment]) as AntelopeConfig;
    }

    config.cacheFolder = config.cacheFolder ?? DEFAULT_CACHE_DIR;

    const modules = config.modules ?? {};
    const expandedModules = this.parser.expandModuleShorthand(modules);

    for (const moduleName of Object.keys(expandedModules)) {
      const moduleConfigPath = getModuleConfigPath(projectFolder, moduleName);
      if (await this.fs.exists(moduleConfigPath)) {
        const moduleConfig = await this.loadJsonFile(moduleConfigPath);
        expandedModules[moduleName].config = mergeDeep(
          (expandedModules[moduleName].config as Record<string, any>) ?? {},
          moduleConfig as Record<string, any>,
        );
      }
    }

    const envOverrides = config.envOverrides ?? {};
    const configWithOverrides = this.parser.applyEnvOverrides({ ...config, modules: expandedModules }, envOverrides);

    const processed = this.parser.processTemplates({
      name: configWithOverrides.name,
      cacheFolder: configWithOverrides.cacheFolder ?? DEFAULT_CACHE_DIR,
      modules: configWithOverrides.modules,
      logging: configWithOverrides.logging,
      envOverrides: envOverrides,
    });

    return {
      ...(processed as LoadedConfig),
      test: configWithOverrides.test,
    };
  }

  private async loadConfigSource(
    projectFolder: string,
    environment?: string,
    configPath?: string,
  ): Promise<AntelopeConfig> {
    const resolvedPath = configPath ?? (await findConfigPath(projectFolder, this.fs));
    return self.loadTsConfigFile(resolvedPath, environment);
  }

  private async loadJsonFile<T>(filePath: string): Promise<T> {
    const content = await this.fs.readFileString(filePath);
    return JSON.parse(content);
  }
}
