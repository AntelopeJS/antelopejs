import chalk from 'chalk';
import { Command, Option } from 'commander';
import { Options, readConfig, writeConfig } from '../../common';
import { LoadConfig } from '../../../common/config';
import { error, warning, info, success } from '../../../utils/cli-ui';
import { selectEnvironment } from '../../../utils/module';

interface RemoveOptions {
  project: string;
  env?: string;
  force: boolean;
}

export async function projectModulesRemoveCommand(modules: string[], options: RemoveOptions) {
  info(chalk.blue`Removing modules from project...`);

  const config = await readConfig(options.project);
  if (!config) {
    error(chalk.red`No project configuration found at: ${options.project}`);
    info(`Make sure you're in an AntelopeJS project or use the --project option.`);
    return;
  }

  const env = selectEnvironment(config, options.env);
  if (!env) {
    error(chalk.red`Environment ${options.env || 'default'} not found in project config`);
    return;
  }

  if (!env.modules || Object.keys(env.modules).length === 0) {
    error(chalk.red`No modules installed in this environment`);
    return;
  }

  const antelopeConfig = await LoadConfig(options.project, options.env || 'default');

  // Track results
  const removedModules: string[] = [];
  const notInstalledModules: string[] = [];

  // Check if all modules exist
  const missingModules = modules.filter((module) => {
    if (!env.modules) return true;
    return !env.modules[module] && !env.modules[':' + module];
  });

  if (missingModules.length > 0) {
    if (missingModules.length === modules.length) {
      error(chalk.red`None of the specified modules are installed in this project.`);
      info(
        `Available modules: ${Object.keys(env.modules)
          .map((m) => chalk.bold(m))
          .join(', ')}`,
      );
      return;
    }

    if (!options.force) {
      error(
        chalk.red`The following modules are not present in the project: ${missingModules
          .map((m) => chalk.bold(m))
          .join(', ')}`,
      );
      return;
    }

    // Continue with warning if --force is used
    warning(chalk.yellow`The following modules will be skipped (not found):`);
    for (const module of missingModules) {
      info(`  ${chalk.yellow('•')} ${chalk.bold(module)}`);
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
    if (env.modules[module]) {
      delete env.modules[module];
      removedModules.push(module);
    } else if (env.modules[':' + module]) {
      delete env.modules[':' + module];
      removedModules.push(':' + module);
    } else {
      notInstalledModules.push(module);
      warning(chalk.yellow`Module ${chalk.bold(module)} is not installed`);
    }
  }

  // Save changes if any modules were removed
  if (removedModules.length > 0) {
    await writeConfig(options.project, config);

    success(chalk.green`Successfully removed ${removedModules.length} module(s):`);
    removedModules.forEach((module) => {
      info(`  ${chalk.green('•')} ${chalk.bold(module)}`);
    });
  } else {
    error(chalk.red`No modules were removed from the project`);
  }

  // Report module dependencies that might be affected
  if (removedModules.length > 0) {
    // Check for potential broken dependencies
    const remainingModules = Object.keys(antelopeConfig.modules).filter(
      (m) => !removedModules.includes(m) && !removedModules.includes(m.replace(':', '')),
    );

    if (remainingModules.length > 0) {
      warning(chalk.yellow`Note: You may need to run 'ajs project modules fix' to resolve any broken dependencies`);
    }
  }
}

export default function () {
  return new Command('remove')
    .alias('rm')
    .description(`Remove modules from your project\n` + `Removes modules from project configuration`)
    .argument('<modules...>', 'Names of modules to remove')
    .addOption(Options.project)
    .addOption(new Option('-e, --env <environment>', 'Environment to remove modules from').env('ANTELOPEJS_LAUNCH_ENV'))
    .addOption(new Option('-f, --force', 'Continue even if some modules are not found').default(false))
    .action(projectModulesRemoveCommand);
}
