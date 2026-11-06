import type { AntelopeConfig } from "@antelopejs/interface-core/config";

import type { IFileSystem } from "../../types";
import { isObject, isString, mergeDeep } from "../../utils";
import {
  assertLoadedConfig,
  decodeOverride,
  type LoadedConfig,
} from "./config-fields";
import { ConfigParser } from "./config-parser";
import {
  DEFAULT_CACHE_DIR,
  findConfigPath,
  getModuleConfigPath,
} from "./config-paths";
import * as tsConfigFile from "./ts-config-file";

export type { LoadedConfig } from "./config-fields";

export class ConfigLoader {
  private parser = new ConfigParser();

  constructor(private fs: IFileSystem) {}

  /**
   * Resolves the project configuration for `environment`, with the
   * `envOverrides` it declares read from `variables`.
   */
  async load(
    projectFolder: string,
    environment?: string,
    configPath?: string,
    variables: NodeJS.ProcessEnv = process.env,
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
    const loaded = { ...config, modules: expandedModules };
    const overridden = this.parser.applyEnvOverrides(
      loaded,
      envOverrides,
      decodeOverride,
      variables,
    );
    const fields = isObject(overridden) ? overridden : {};

    const processed = this.parser.processTemplates({
      name: fields.name,
      cacheFolder: fields.cacheFolder ?? DEFAULT_CACHE_DIR,
      modules: fields.modules,
      logging: fields.logging,
      envOverrides: envOverrides,
    });
    const resolved: unknown = isObject(processed)
      ? { ...processed, test: fields.test }
      : processed;
    assertLoadedConfig(resolved, {
      name: config.name,
      cacheFolder: config.cacheFolder,
      modules: expandedModules,
      logging: config.logging,
      envOverrides,
      test: config.test,
    });

    return resolved;
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

  /**
   * Reads a module's `antelope.<module>.json` file as the entries to merge
   * into its configuration. An object contributes its own keys, a string or an
   * array its index keys, and `null`, a number or a boolean nothing, as the
   * historic merge of the parsed value did.
   */
  private async loadJsonFile(
    filePath: string,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- an antelope.<module>.json merged into a module config whose values are user data of any shape
  ): Promise<Record<string, unknown>> {
    const content = await this.fs.readFileString(filePath);
    const parsed: unknown = JSON.parse(content);
    if (isObject(parsed)) {
      return parsed;
    }
    if (isString(parsed)) {
      return Object.fromEntries(parsed.split("").entries());
    }
    if (Array.isArray(parsed)) {
      const items: unknown[] = parsed;
      return Object.fromEntries(items.entries());
    }
    return {};
  }
}
