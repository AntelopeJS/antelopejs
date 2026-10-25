import { createJiti } from "jiti";
import type {
  AntelopeConfig,
  AntelopeLogging,
  AntelopeTestConfig,
  ConfigInput,
} from "@antelopejs/interface-core/config";

// oxlint-disable-next-line import/no-self-import, import/no-cycle -- test seam: calls go through `self.` so `sinon.stub(module, "fn")` takes effect
import * as self from "./config-loader";
import type { IFileSystem } from "../../types";
import { mergeDeep } from "../../utils/object";
import { ConfigParser, type ExpandedModuleConfig } from "./config-parser";
import {
  DEFAULT_CACHE_DIR,
  DEFAULT_ENV,
  findConfigPath,
  getModuleConfigPath,
} from "./config-paths";

const CORE_CONFIG_PACKAGE = "@antelopejs/interface-core/config";
const CORE_CONFIG_ENTRY = require.resolve(CORE_CONFIG_PACKAGE);

export interface LoadedConfig {
  name: string;
  cacheFolder: string;
  modules: Record<string, ExpandedModuleConfig>;
  logging?: AntelopeLogging;
  envOverrides: Record<string, string | string[]>;
  test?: AntelopeTestConfig;
}

/**
 * Imports the configuration file. `fresh` skips jiti's module and file
 * caches, for a file the running process may have written since it last read
 * it.
 */
async function importConfigInput(
  configPath: string,
  fresh = false,
): Promise<ConfigInput> {
  const options: NonNullable<Parameters<typeof createJiti>[1]> = {
    alias: { [CORE_CONFIG_PACKAGE]: CORE_CONFIG_ENTRY },
  };
  if (fresh) {
    options.moduleCache = false;
    options.fsCache = false;
  }
  const jiti = createJiti(configPath, options);
  const loaded = await jiti.import(configPath);
  return (loaded as any).default ?? loaded;
}

export async function loadTsConfigFile(
  configPath: string,
  environment?: string,
  fresh = false,
): Promise<AntelopeConfig> {
  const configInput = await importConfigInput(configPath, fresh);

  if (typeof configInput === "function") {
    return await configInput({ env: environment ?? DEFAULT_ENV });
  }

  return configInput;
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
          (expandedModules[moduleName].config as Record<string, any>) ?? {},
          moduleConfig as Record<string, any>,
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
      ...(processed as LoadedConfig),
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
    return self.loadTsConfigFile(resolvedPath, environment);
  }

  private async loadJsonFile<T>(filePath: string): Promise<T> {
    const content = await this.fs.readFileString(filePath);
    return JSON.parse(content);
  }
}
