import type {
  AntelopeConfig,
  ConfigInput,
} from "@antelopejs/interface-core/config";
import { createJiti } from "jiti";
import path from "node:path";

import { isFunction } from "../../utils";
import { DEFAULT_ENV } from "./config-paths";
import { loadProjectEnv } from "./project-env";

const CORE_CONFIG_PACKAGE = "@antelopejs/interface-core/config";
const CORE_CONFIG_ENTRY = require.resolve(CORE_CONFIG_PACKAGE);

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
  const loaded = await jiti.import<ConfigInput & { default?: ConfigInput }>(
    configPath,
  );
  return loaded.default ?? loaded;
}

export async function loadTsConfigFile(
  configPath: string,
  environment?: string,
  fresh = false,
): Promise<AntelopeConfig> {
  loadProjectEnv(path.dirname(configPath));
  const configInput = await importConfigInput(configPath, fresh);

  if (isFunction(configInput)) {
    return await configInput({ env: environment ?? DEFAULT_ENV });
  }

  return configInput;
}
