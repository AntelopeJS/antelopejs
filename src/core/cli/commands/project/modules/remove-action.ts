import chalk from "chalk";

import { ConfigLoader } from "../../../../config";
import { NodeFileSystem } from "../../../../filesystem";
import { error, info, success, warning } from "../../../cli-ui";
import { writeConfig } from "../../../common";
import { FAILURE_EXIT_CODE } from "../../../exit-codes";
import { resolveProjectContext } from "../../shared/project-command";

interface RemoveOptions {
  project: string;
  env?: string;
  force: boolean;
}

export async function projectModulesRemoveCommand(
  modules: string[],
  options: RemoveOptions,
) {
  const {
    config,
    environment,
    environmentConfig: env,
  } = await resolveProjectContext(options.project, options.env);
  info(chalk.blue`Removing modules from project...`);

  if (!env.modules || Object.keys(env.modules).length === 0) {
    error(chalk.red`No modules installed in this environment`);
    process.exitCode = FAILURE_EXIT_CODE;
    return;
  }

  const envModules = env.modules!;

  const loader = new ConfigLoader(new NodeFileSystem());
  const antelopeConfig = await loader.load(options.project, environment);

  // Track results
  const removedModules: string[] = [];
  const notInstalledModules: string[] = [];

  // Check if all modules exist
  const missingModules = modules.filter(
    (module) => !envModules[module] && !envModules[`:${module}`],
  );

  if (missingModules.length > 0) {
    if (missingModules.length === modules.length) {
      error(
        chalk.red`None of the specified modules are installed in this project.`,
      );
      info(
        `Available modules: ${Object.keys(envModules)
          .map((m) => chalk.bold(m))
          .join(", ")}`,
      );
      process.exitCode = FAILURE_EXIT_CODE;
      return;
    }

    if (!options.force) {
      error(
        chalk.red`The following modules are not present in the project: ${missingModules
          .map((m) => chalk.bold(m))
          .join(", ")}`,
      );
      process.exitCode = FAILURE_EXIT_CODE;
      return;
    }

    // Continue with warning if --force is used
    warning(chalk.yellow`The following modules will be skipped (not found):`);
    for (const module of missingModules) {
      info(`  ${chalk.yellow("•")} ${chalk.bold(module)}`);
    }
  }

  // Remove modules
  for (const module of modules) {
    // Skip modules that don't exist if using --force
    if (missingModules.includes(module) && options.force) {
      warning(chalk.yellow`Module ${chalk.bold(module)} is not installed`);
      continue;
    }

    // Check standard name and prefixed name (:name)
    if (envModules[module]) {
      delete envModules[module];
      removedModules.push(module);
    } else if (envModules[`:${module}`]) {
      delete envModules[`:${module}`];
      removedModules.push(`:${module}`);
    } else {
      notInstalledModules.push(module);
      warning(chalk.yellow`Module ${chalk.bold(module)} is not installed`);
    }
  }

  // Save changes if any modules were removed
  if (removedModules.length > 0) {
    await writeConfig(options.project, config);

    success(
      chalk.green`Successfully removed ${removedModules.length} module(s):`,
    );
    removedModules.forEach((module) => {
      info(`  ${chalk.green("•")} ${chalk.bold(module)}`);
    });
  } else {
    error(chalk.red`No modules were removed from the project`);
    process.exitCode = FAILURE_EXIT_CODE;
  }

  // Report module dependencies that might be affected
  if (removedModules.length > 0) {
    // Check for potential broken dependencies
    const remainingModules = Object.keys(antelopeConfig.modules).filter(
      (m) =>
        !removedModules.includes(m) &&
        !removedModules.includes(m.replace(":", "")),
    );

    if (remainingModules.length > 0) {
      warning(
        chalk.yellow`Note: You may need to run 'ajs project modules install' to resolve any broken dependencies`,
      );
    }
  }
}
