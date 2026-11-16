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

/** The error Node and jiti throw for an import of a module that is not there. */
interface MissingModuleError extends Error {
  code: typeof MISSING_MODULE_CODE;
  /** The importing files, the direct importer first. */
  requireStack: string[];
}

function isMissingModuleError(error: unknown): error is MissingModuleError {
  return (
    error instanceof Error &&
    isObject(error) &&
    error.code === MISSING_MODULE_CODE &&
    Array.isArray(error.requireStack) &&
    error.requireStack.every(isString)
  );
}

/** A failed import, by a file of the project, of a module that is not there. */
interface MissingProjectImport {
  error: Error;
  /** The project file that imports it, relative to the project. */
  importer: string;
}

function isProjectFile(projectFolder: string, file: string): boolean {
  const relative = path.relative(projectFolder, file);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative) &&
    !relative.split(path.sep).includes("node_modules")
  );
}

/**
 * The missing module `error` reports when a file of the project imported it,
 * as the configuration and the files it imports do while it is evaluated.
 */
function findMissingProjectImport(
  error: MissingModuleError,
  projectFolder: string,
): MissingProjectImport | undefined {
  const importer = error.requireStack.at(0);
  const folder = path.resolve(projectFolder);
  if (importer === undefined || !isProjectFile(folder, importer)) {
    return undefined;
  }
  return { error, importer: path.relative(folder, importer) };
}

function missingProjectImportError({
  error,
  importer,
}: MissingProjectImport): CliError {
  return new CliError(
    {
      title: `Could not evaluate ${TS_CONFIG_FILE} without the sources of the project`,
      reason: `${error.message.split("\n")[0]}, imported by ${importer}`,
      fixes: [
        `Copy that file along with ${TS_CONFIG_FILE}, or install the package it names, before '${MODULES_ONLY_COMMAND}'`,
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
    headline: `Installed ${pluralize(installed, "module")}`,
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
    const missing =
      commandOptions.modulesOnly && isMissingModuleError(error)
        ? findMissingProjectImport(error, commandOptions.project)
        : undefined;
    throw missing ? missingProjectImportError(missing) : error;
  }
}
