import { ConfigLoader } from "../../../../config";
import { NodeFileSystem } from "../../../../filesystem";
import { error, info } from "../../../cli-ui";
import { writeConfig } from "../../../common";
import { FAILURE_EXIT_CODE } from "../../../exit-codes";
import {
  getProcessPalette,
  getProcessUi,
  pluralize,
  type NextStep,
} from "../../../output";
import { TS_CONFIG_FILE } from "../../../../config/config-paths";
import { formatNames } from "../../shared/names";
import { scopedCommand } from "../../shared/next-steps";
import { resolveProjectContext } from "../../shared/project-command";

const INSTALL_COMMAND = "ajs project modules install";
const INSTALL_DESCRIPTION = "check that every interface is still implemented";
const FOLDER_MODULE_PREFIX = ":";

function removeModule(
  envModules: Record<string, unknown>,
  module: string,
): string {
  const key = envModules[module] ? module : `${FOLDER_MODULE_PREFIX}${module}`;
  delete envModules[key];
  getProcessUi().message(
    "success",
    `Removed ${getProcessPalette().bold(module)}`,
  );
  return key;
}

function removalNextSteps(
  remainingModules: string[],
  options: RemoveOptions,
): NextStep[] {
  if (remainingModules.length === 0) {
    return [];
  }
  return [
    {
      command: scopedCommand(INSTALL_COMMAND, options),
      description: INSTALL_DESCRIPTION,
    },
  ];
}

interface RemoveOptions {
  project: string;
  env?: string;
  force: boolean;
}

function rejectMissingModules(
  missingModules: string[],
  modules: string[],
  envModules: Record<string, unknown>,
  options: RemoveOptions,
): boolean {
  if (missingModules.length === modules.length) {
    error("None of the specified modules are installed in this project.");
    info(`Available modules: ${formatNames(Object.keys(envModules))}`);
    return true;
  }
  if (missingModules.length > 0 && !options.force) {
    error(
      `The following modules are not present in the project: ${formatNames(missingModules)}`,
    );
    return true;
  }
  return false;
}

function removeModules(
  modules: string[],
  missingModules: string[],
  envModules: Record<string, unknown>,
): string[] {
  return modules.flatMap((module) => {
    if (missingModules.includes(module)) {
      getProcessUi().message(
        "skip",
        `Skipped ${getProcessPalette().bold(module)}: not in the project`,
      );
      return [];
    }
    return [removeModule(envModules, module)];
  });
}

export async function projectModulesRemoveCommand(
  modules: string[],
  options: RemoveOptions,
) {
  const startedAt = Date.now();
  const {
    config,
    environment,
    environmentConfig: env,
  } = await resolveProjectContext(options.project, options.env);
  const envModules = env.modules ?? {};
  if (Object.keys(envModules).length === 0) {
    error("No modules installed in this environment");
    process.exitCode = FAILURE_EXIT_CODE;
    return;
  }
  const loader = new ConfigLoader(new NodeFileSystem());
  const antelopeConfig = await loader.load(options.project, environment);
  const requested = [...new Set(modules)];
  const missingModules = requested.filter(
    (module) =>
      !envModules[module] && !envModules[`${FOLDER_MODULE_PREFIX}${module}`],
  );
  if (rejectMissingModules(missingModules, requested, envModules, options)) {
    process.exitCode = FAILURE_EXIT_CODE;
    return;
  }

  const removedKeys = removeModules(requested, missingModules, envModules);
  await writeConfig(options.project, config);
  const remainingModules = Object.keys(antelopeConfig.modules).filter(
    (m) => !removedKeys.includes(m),
  );
  getProcessUi().summary({
    headline: `${pluralize(removedKeys.length, "module")} removed from ${TS_CONFIG_FILE}`,
    durationMs: Date.now() - startedAt,
    nextSteps: removalNextSteps(remainingModules, options),
  });
}
