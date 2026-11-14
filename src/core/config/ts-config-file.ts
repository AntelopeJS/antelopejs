import type {
  AntelopeConfig,
  ConfigInput,
} from "@antelopejs/interface-core/config";
import { createJiti } from "jiti";
import path from "node:path";

import { isFunction } from "../../utils";
import { assertAntelopeConfig } from "./config-fields";
import { DEFAULT_ENV } from "./config-paths";
import { loadProjectEnv } from "./project-env";

const CORE_CONFIG_PACKAGE = "@antelopejs/interface-core/config";
const CORE_CONFIG_ENTRY = require.resolve(CORE_CONFIG_PACKAGE);

/**
 * Imports the configuration file. `fresh` skips jiti's module cache, for a
 * file the running process may have written since it last read it. Its file
 * cache stays on: an entry is reused only for the same source text.
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
  }
  const jiti = createJiti(configPath, options);
  const loaded = await jiti.import<ConfigInput & { default?: ConfigInput }>(
    configPath,
  );
  return loaded.default ?? loaded;
}

/**
 * The environment names the configuration file at `configPath` accepts:
 * `default` and the keys of its `environments` map. `undefined` when the file
 * exports a function and declares no map, since it then accepts any name.
 */
export async function readEnvironmentNames(
  configPath: string,
): Promise<string[] | undefined> {
  loadProjectEnv(path.dirname(configPath));
  const configInput = await importConfigInput(configPath, true);
  const config: unknown = isFunction(configInput)
    ? await configInput({ env: DEFAULT_ENV })
    : configInput;
  assertAntelopeConfig(config, configPath);
  if (isFunction(configInput) && config.environments === undefined) {
    return undefined;
  }
  return [DEFAULT_ENV, ...Object.keys(config.environments ?? {})];
}

/**
 * Loads the project configuration file at `configPath`, calling it with
 * `environment` when it exports a function. Throws an error naming the field
 * and the file when the value does not hold the declared `AntelopeConfig`
 * contract.
 */
export async function loadTsConfigFile(
  configPath: string,
  environment?: string,
  fresh = false,
): Promise<AntelopeConfig> {
  loadProjectEnv(path.dirname(configPath));
  const configInput = await importConfigInput(configPath, fresh);

  const config: unknown = isFunction(configInput)
    ? await configInput({ env: environment ?? DEFAULT_ENV })
    : configInput;
  assertAntelopeConfig(config, configPath);
  return config;
}
