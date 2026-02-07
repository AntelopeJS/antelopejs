import * as path from 'path';
import { IFileSystem, AntelopeConfig, AntelopeLogging } from '../../types';
import { ConfigParser, ExpandedModuleConfig } from './config-parser';
import { mergeDeep } from '../../utils/object';

export interface LoadedConfig {
  name: string;
  cacheFolder: string;
  modules: Record<string, ExpandedModuleConfig>;
  logging?: AntelopeLogging;
  envOverrides: Record<string, string | string[]>;
}

const DEFAULT_CACHE_DIR = '.antelope/cache';

export class ConfigLoader {
  private parser = new ConfigParser();

  constructor(private fs: IFileSystem) {}

  async load(projectFolder: string, environment?: string): Promise<LoadedConfig> {
    const configPath = path.join(projectFolder, 'antelope.json');
    const rawConfig = await this.loadJsonFile<AntelopeConfig>(configPath);

    let config = { ...rawConfig };
    if (environment && rawConfig.environments?.[environment]) {
      config = mergeDeep(config, rawConfig.environments[environment]) as AntelopeConfig;
    }

    config.cacheFolder = config.cacheFolder ?? DEFAULT_CACHE_DIR;

    const modules = config.modules ?? {};
    const expandedModules = this.parser.expandModuleShorthand(modules);

    for (const moduleName of Object.keys(expandedModules)) {
      const moduleConfigPath = path.join(projectFolder, `antelope.${moduleName}.json`);
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

    return processed as LoadedConfig;
  }

  private async loadJsonFile<T>(filePath: string): Promise<T> {
    const content = await this.fs.readFileString(filePath);
    return JSON.parse(content);
  }
}
