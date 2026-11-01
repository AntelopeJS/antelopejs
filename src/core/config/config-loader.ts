import type {
  AntelopeConfig,
  AntelopeLogging,
  AntelopeTestConfig,
} from "@antelopejs/interface-core/config";

import type { IFileSystem } from "../../types";
import { isObject, mergeDeep, type UnknownDictionary } from "../../utils";
import { ConfigParser, type ExpandedModuleConfig } from "./config-parser";
import {
  DEFAULT_CACHE_DIR,
  findConfigPath,
  getModuleConfigPath,
} from "./config-paths";
import * as tsConfigFile from "./ts-config-file";

export interface LoadedConfig {
  name: string;
  cacheFolder: string;
  modules: Record<string, ExpandedModuleConfig>;
  logging?: AntelopeLogging;
  envOverrides: Record<string, string | string[]>;
  test?: AntelopeTestConfig;
}

export class ConfigLoader {
  private parser = new ConfigParser();

  constructor(private fs: IFileSystem) {}

  async load(
    projectFolder: string,
    environment?: string,
    configPath?: string,
  ): Promise<LoadedConfig> {
    const rawConfig = await this.loadConfigSource(
      projectFolder,
      environment,
      configPath,
    );

    let config = { ...rawConfig };
    if (environment && rawConfig.environments?.[environment]) {
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Environment overrides are not validated today; checking required fields would change acceptance (#228).
      config = mergeDeep(
        config,
        rawConfig.environments[environment],
      ) as AntelopeConfig;
    }

    config.cacheFolder = config.cacheFolder ?? DEFAULT_CACHE_DIR;

    const modules = config.modules ?? {};
    const expandedModules = this.parser.expandModuleShorthand(modules);

    for (const moduleName of Object.keys(expandedModules)) {
      const moduleConfigPath = getModuleConfigPath(projectFolder, moduleName);
      if (await this.fs.exists(moduleConfigPath)) {
        const moduleConfig = await this.loadJsonFile(moduleConfigPath);
        expandedModules[moduleName].config = mergeDeep(
          // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Module config can contain arbitrary unchecked values; narrowing the historic merge would reject existing inputs (#228).
          (expandedModules[moduleName].config as Parameters<
            typeof mergeDeep
          >[0]) ?? {},
          moduleConfig,
        );
      }
    }

    const envOverrides = config.envOverrides ?? {};
    const configWithOverrides = this.parser.applyEnvOverrides(
      { ...config, modules: expandedModules },
      envOverrides,
    );

    const processed = this.parser.processTemplates({
      name: configWithOverrides.name,
      cacheFolder: configWithOverrides.cacheFolder ?? DEFAULT_CACHE_DIR,
      modules: configWithOverrides.modules,
      logging: configWithOverrides.logging,
      envOverrides: envOverrides,
    });

    return {
      ...processed,
      test: configWithOverrides.test,
    };
  }

  private async loadConfigSource(
    projectFolder: string,
    environment?: string,
    configPath?: string,
  ): Promise<AntelopeConfig> {
    const resolvedPath =
      configPath ?? (await findConfigPath(projectFolder, this.fs));
    return tsConfigFile.loadTsConfigFile(resolvedPath, environment, true);
  }

  /** Reads a module's `antelope.<module>.json` file, which must hold a JSON object. */
  private async loadJsonFile(filePath: string): Promise<UnknownDictionary> {
    const content = await this.fs.readFileString(filePath);
    const parsed: unknown = JSON.parse(content);
    if (!isObject(parsed)) {
      throw new Error(
        `Module configuration '${filePath}' is not a JSON object`,
      );
    }
    return parsed;
  }
}
