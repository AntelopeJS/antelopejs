import chalk from 'chalk';
import { Command } from 'commander';
import { Spinner } from '../../cli-ui';
import { readConfig } from '../../common';

export interface ProjectCommandOptions {
  project: string;
  env?: string;
  verbose?: string[];
}

const DEFAULT_PROJECT_NAME = 'unnamed';

export function resolveInheritedVerbose(command: Command, verbose?: string[]): string[] | undefined {
  if (verbose) {
    return verbose;
  }
  return command.parent?.parent?.getOptionValue('verbose') as string[] | undefined;
}

export async function validateProjectExists(projectFolder: string): Promise<boolean> {
  const checkSpinner = new Spinner(`Looking for AntelopeJS project at ${chalk.cyan(projectFolder)}`);
  await checkSpinner.start();

  const config = await readConfig(projectFolder);
  if (!config) {
    await checkSpinner.fail(`No project found at ${chalk.bold(projectFolder)}`);
    console.log(`Run ${chalk.cyan.bold(`ajs project init <project-name>`)} to create a new project.`);
    process.exitCode = 1;
    return false;
  }

  const projectName = config.name || DEFAULT_PROJECT_NAME;
  await checkSpinner.succeed(`Found project: ${chalk.green.bold(projectName)}`);
  return true;
}
