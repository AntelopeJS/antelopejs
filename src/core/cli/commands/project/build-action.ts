import chalk from "chalk";
import type { Command } from "commander";

import { build } from "../../../..";
import { displayBox, info } from "../../cli-ui";
import { displayPath, getProcessUi, pluralize } from "../../output";
import {
  getBuildArtifactPath,
  readBuildArtifact,
} from "../../../build/build-artifact";
import { scopedCommand } from "../shared/next-steps";
import {
  findProject,
  type ProjectCommandOptions,
  type ProjectContext,
  resolveInheritedVerbose,
} from "../shared/project-command";

interface BuildCommandOptions extends ProjectCommandOptions {
  project: string;
}

const START_COMMAND = "ajs project start";
const START_DESCRIPTION = "start the project from this build";

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
  options: BuildCommandOptions,
  durationMs: number,
): Promise<void> {
  const artifact = await readBuildArtifact(options.project);
  const moduleCount = Object.keys(artifact.modules).length;
  getProcessUi().summary({
    headline: `Built ${pluralize(moduleCount, "module")}`,
    durationMs,
    artifact: displayPath(getBuildArtifactPath(options.project)),
    nextSteps: [
      {
        command: scopedCommand(START_COMMAND, options),
        description: START_DESCRIPTION,
      },
    ],
  });
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
  await displayBuildSummary(commandOptions, Date.now() - startedAt);
}
