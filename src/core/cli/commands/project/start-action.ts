import type { Command } from "commander";

import { info } from "../../cli-ui";
import { displayPath, getProcessUi, reportFailure } from "../../output";
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

function showStartConfiguration(options: StartCommandOptions): void {
  const ui = getProcessUi();
  const concurrency =
    options.concurrency?.toString() ?? ui.palette().dim(DISABLED_LABEL);
  ui.details(
    [
      { label: "Environment", value: options.env ?? DEFAULT_ENV },
      { label: "Project", value: displayPath(options.project) },
      { label: "Concurrency", value: concurrency },
    ],
    "feedback",
  );
}

export async function runStart(
  this: Command,
  options: StartCommandOptions,
): Promise<void> {
  const commandOptions = normalizeOptions(this, options);
  const hasProject = await validateProjectExists(commandOptions.project);
  if (!hasProject) {
    return;
  }

  showStartConfiguration(commandOptions);
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
