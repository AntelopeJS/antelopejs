import type { Command } from "commander";
import path from "node:path";

import { build, installRemoteModules } from "../../../core/build";
import { TS_CONFIG_FILE } from "../../../core/config";
import { getBuildArtifactPath, readBuildArtifact } from "../../../core/modules";
import {
  CliError,
  displayPath,
  getProcessUi,
  info,
  pluralize,
} from "../../../core/output";
import type { BuildOptions } from "../../../core/runtime";
import { isEnvironmentFlagSet, isObject, isString } from "../../../utils";
import { scopedCommand } from "../shared/next-steps";
import {
  findProject,
  type ProjectCommandOptions,
  type ProjectContext,
  resolveInheritedVerbose,
} from "../shared/project-command";

interface BuildCommandOptions extends ProjectCommandOptions {
  project: string;
  frozenModules?: boolean;
  modulesOnly?: boolean;
}

const FROZEN_MODULES_ENV = "ANTELOPEJS_FROZEN_MODULES";

const START_COMMAND = "ajs project start";
const START_DESCRIPTION = "start the project from this build";
const BUILD_COMMAND = "ajs project build";
const BUILD_DESCRIPTION =
  "build the project once its sources are there, reusing these modules";
const MODULES_ONLY_COMMAND = "ajs project build --modules-only";
const MISSING_MODULE_CODE = "MODULE_NOT_FOUND";

function normalizeOptions(
  command: Command,
  options: BuildCommandOptions,
): BuildCommandOptions {
  return {
    ...options,
    verbose: resolveInheritedVerbose(command, options.verbose),
  };
}

function showBuildConfiguration(
  options: BuildCommandOptions,
  context: ProjectContext,
): void {
  getProcessUi().details(
    [
      { label: "Environment", value: context.environment },
      { label: "Project", value: displayPath(options.project) },
      ...(options.modulesOnly
        ? []
        : [
            {
              label: "Output",
              value: displayPath(getBuildArtifactPath(options.project)),
            },
          ]),
    ],
    "feedback",
  );
}

/** Whether `error` is the import of a missing file by the project configuration. */
function isMissingConfigImport(error: unknown): error is Error {
  return (
    error instanceof Error &&
    isObject(error) &&
    error.code === MISSING_MODULE_CODE &&
    Array.isArray(error.requireStack) &&
    error.requireStack.some(
      (file) => isString(file) && path.basename(file) === TS_CONFIG_FILE,
    )
  );
}

function missingConfigImportError(error: Error): CliError {
  return new CliError(
    {
      title: `Could not evaluate ${TS_CONFIG_FILE} without the sources of the project`,
      reason: error.message.split("\n")[0],
      fixes: [
        `Copy the file it names along with ${TS_CONFIG_FILE} and antelope-lock/ before '${MODULES_ONLY_COMMAND}'`,
      ],
    },
    { cause: error },
  );
}

async function runModulesOnly(
  options: BuildCommandOptions,
  context: ProjectContext,
  buildOptions: BuildOptions,
): Promise<void> {
  info(`Installing the modules of the AntelopeJS project`);
  const startedAt = Date.now();
  const installed = await installRemoteModules(
    options.project,
    context.environment,
    buildOptions,
  );
  getProcessUi().summary({
    headline: `Installed ${pluralize(installed.length, "module")}`,
    durationMs: Date.now() - startedAt,
    nextSteps: [
      {
        command: scopedCommand(BUILD_COMMAND, options),
        description: BUILD_DESCRIPTION,
      },
    ],
  });
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

async function runFullBuild(
  options: BuildCommandOptions,
  context: ProjectContext,
  buildOptions: BuildOptions,
): Promise<void> {
  info(`Building AntelopeJS project`);
  const startedAt = Date.now();
  await build(options.project, context.environment, buildOptions);
  await displayBuildSummary(options, Date.now() - startedAt);
}

async function runBuildCommand(options: BuildCommandOptions): Promise<void> {
  const context = await findProject(options.project, options.env);
  showBuildConfiguration(options, context);
  const buildOptions: BuildOptions = {
    verbose: options.verbose,
    frozenModules: isEnvironmentFlagSet(FROZEN_MODULES_ENV)
      ? true
      : options.frozenModules,
  };
  const run = options.modulesOnly ? runModulesOnly : runFullBuild;
  await run(options, context, buildOptions);
}

export async function runBuild(
  this: Command,
  options: BuildCommandOptions,
): Promise<void> {
  const commandOptions = normalizeOptions(this, options);
  try {
    await runBuildCommand(commandOptions);
  } catch (error) {
    if (commandOptions.modulesOnly && isMissingConfigImport(error)) {
      throw missingConfigImportError(error);
    }
    throw error;
  }
}
