import chalk from "chalk";
import type { Command } from "commander";

import { build } from "../../../..";
import { displayBox, info, success } from "../../cli-ui";
import { readBuildArtifact } from "../../../build/build-artifact";
import {
  findProject,
  type ProjectCommandOptions,
  type ProjectContext,
  resolveInheritedVerbose,
} from "../shared/project-command";

interface BuildCommandOptions extends ProjectCommandOptions {
  project: string;
}
const MINUTE_IN_MILLISECONDS = 60000;

function formatBuildDuration(durationMs: number): string {
  if (durationMs < MINUTE_IN_MILLISECONDS) {
    return `${durationMs}ms`;
  }

  const minutes = Math.floor(durationMs / MINUTE_IN_MILLISECONDS);
  const remainingMs = durationMs % MINUTE_IN_MILLISECONDS;
  return `${minutes}m ${remainingMs}ms`;
}

function normalizeOptions(
  command: Command,
  options: BuildCommandOptions,
): BuildCommandOptions {
  return {
    ...options,
    verbose: resolveInheritedVerbose(command, options.verbose),
  };
}

async function showBuildConfiguration(
  options: BuildCommandOptions,
  context: ProjectContext,
): Promise<void> {
  await displayBox(
    `Environment: ${chalk.cyan(context.environment)}\n` +
      `Project: ${chalk.cyan(options.project)}\n` +
      `Output: ${chalk.cyan(".antelope/build/build.json")}`,
    "󱌢 Build Configuration",
    { padding: 1 },
  );
}

async function displayBuildSummary(
  projectFolder: string,
  buildDuration: number,
): Promise<void> {
  const artifact = await readBuildArtifact(projectFolder);
  const moduleCount = Object.keys(artifact.modules).length;
  const formattedDuration = formatBuildDuration(buildDuration);
  success(
    `Build completed: ${moduleCount} module(s) prepared in ${formattedDuration}`,
  );
}

export async function runBuild(
  this: Command,
  options: BuildCommandOptions,
): Promise<void> {
  const commandOptions = normalizeOptions(this, options);
  const context = await findProject(commandOptions.project, commandOptions.env);

  console.log("");
  await showBuildConfiguration(commandOptions, context);

  console.log("");
  info(`Building AntelopeJS project`);

  const startedAt = Date.now();
  await build(commandOptions.project, context.environment, {
    verbose: commandOptions.verbose,
  });
  await displayBuildSummary(commandOptions.project, Date.now() - startedAt);
}
