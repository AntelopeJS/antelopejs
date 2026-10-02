import chalk from "chalk";
import type { Command } from "commander";

import { displayBox, info } from "../../cli-ui";
import { reportFailure } from "../../output";
import { startFailureExitCode, startFromBuild } from "../../production-start";
import { type BuildLaunchOptions, DEFAULT_ENV } from "../../../..";
import {
  type ProjectCommandOptions,
  resolveInheritedVerbose,
  validateProjectExists,
} from "../shared/project-command";

interface StartCommandOptions
  extends ProjectCommandOptions, BuildLaunchOptions {
  project: string;
}
const DISABLED_LABEL = "disabled";

function normalizeOptions(
  command: Command,
  options: StartCommandOptions,
): StartCommandOptions {
  return {
    ...options,
    verbose: resolveInheritedVerbose(command, options.verbose),
  };
}

async function showStartConfiguration(
  options: StartCommandOptions,
): Promise<void> {
  const concurrency = options.concurrency?.toString() ?? DISABLED_LABEL;
  await displayBox(
    `Environment: ${chalk.cyan(options.env ?? DEFAULT_ENV)}\n` +
      `Project: ${chalk.cyan(options.project)}\n` +
      `Concurrency: ${options.concurrency ? chalk.green(concurrency) : chalk.gray(concurrency)}`,
    " Start Configuration",
    { padding: 1 },
  );
}

export async function runStart(
  this: Command,
  options: StartCommandOptions,
): Promise<void> {
  const commandOptions = normalizeOptions(this, options);
  console.log("");

  const hasProject = await validateProjectExists(commandOptions.project);
  if (!hasProject) {
    return;
  }

  console.log("");
  await showStartConfiguration(commandOptions);

  console.log("");
  info(`Starting AntelopeJS project from build artifact`);

  try {
    await startFromBuild({
      project: commandOptions.project,
      env: commandOptions.env ?? DEFAULT_ENV,
      concurrency: commandOptions.concurrency,
      verbose: commandOptions.verbose,
      refreshConfig: commandOptions.refreshConfig ?? false,
      help: false,
    });
  } catch (err) {
    reportFailure(err);
    process.exitCode = startFailureExitCode(err);
  }
}
