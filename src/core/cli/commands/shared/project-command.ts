import type { Command } from "commander";
import type { AntelopeConfig } from "@antelopejs/interface-core/config";

import { Spinner } from "../../cli-ui";
import { CliError, getProcessPalette, reportCliError } from "../../output";
import { isDynamicConfig, readConfig } from "../../common";
import { USAGE_EXIT_CODE } from "../../exit-codes";
import { NodeFileSystem } from "../../../filesystem";
import { DEFAULT_ENV } from "../../../config/config-paths";

export interface ProjectCommandOptions {
  project: string;
  env?: string;
  verbose?: string[];
}

export interface ProjectContext {
  config: AntelopeConfig;
  environment: string;
  environmentConfig: Partial<AntelopeConfig>;
}

const DEFAULT_PROJECT_NAME = "unnamed";
const PROJECT_INIT_COMMAND = "ajs project init <project-name>";

export function resolveInheritedVerbose(
  command: Command,
  verbose?: string[],
): string[] | undefined {
  if (verbose) {
    return verbose;
  }
  return command.parent?.parent?.getOptionValue("verbose") as
    | string[]
    | undefined;
}

export function listKnownEnvironments(config: AntelopeConfig): string[] {
  return [DEFAULT_ENV, ...Object.keys(config.environments ?? {})];
}

function projectNotFoundError(projectFolder: string): CliError {
  return new CliError({
    title: `No AntelopeJS project found at ${projectFolder}`,
    fixes: [
      `Run ${getProcessPalette().cyan(PROJECT_INIT_COMMAND)} to create one, or pass --project <path>`,
    ],
  });
}

function unknownEnvironmentError(
  config: AntelopeConfig,
  environment: string,
): CliError {
  return new CliError({
    title: `Unknown environment '${environment}'`,
    reason: `Known environments: ${listKnownEnvironments(config).join(", ")}`,
    fixes: [
      `Pass one of them with --env, or add an "environments.${environment}" entry to the project configuration`,
    ],
    exitCode: USAGE_EXIT_CODE,
  });
}

function findEnvironmentConfig(
  config: AntelopeConfig,
  environment: string,
): Partial<AntelopeConfig> | undefined {
  return environment === DEFAULT_ENV
    ? config
    : config.environments?.[environment];
}

async function acceptsAnyEnvironment(
  projectFolder: string,
  config: AntelopeConfig,
): Promise<boolean> {
  return !config.environments && (await isDynamicConfig(projectFolder));
}

async function resolveEnvironmentConfig(
  projectFolder: string,
  config: AntelopeConfig,
  environment: string,
): Promise<Partial<AntelopeConfig>> {
  const environmentConfig = findEnvironmentConfig(config, environment);
  if (environmentConfig) {
    return environmentConfig;
  }
  if (await acceptsAnyEnvironment(projectFolder, config)) {
    return config;
  }
  throw unknownEnvironmentError(config, environment);
}

/**
 * Reads the project configuration for the requested environment and checks
 * that environment before the command does any work. The known environments
 * are `default` and the keys of `environments`; a configuration exported as a
 * function that returns no `environments` accepts any name. Throws a
 * {@link CliError} when the folder holds no project, or a usage error listing
 * the known environments when the environment is unknown.
 */
export async function resolveProjectContext(
  projectFolder: string,
  requestedEnvironment?: string,
): Promise<ProjectContext> {
  const environment = requestedEnvironment || DEFAULT_ENV;
  const config = await readConfig(
    projectFolder,
    new NodeFileSystem(),
    environment,
  );
  if (!config) {
    throw projectNotFoundError(projectFolder);
  }
  const environmentConfig = await resolveEnvironmentConfig(
    projectFolder,
    config,
    environment,
  );
  return { config, environment, environmentConfig };
}

export async function findProject(
  projectFolder: string,
  environment?: string,
): Promise<ProjectContext> {
  const checkSpinner = new Spinner(
    `Looking for AntelopeJS project at ${getProcessPalette().dim(projectFolder)}`,
  );
  await checkSpinner.start();

  try {
    const context = await resolveProjectContext(projectFolder, environment);
    const projectName = context.config.name || DEFAULT_PROJECT_NAME;
    await checkSpinner.succeed(
      `Found project: ${getProcessPalette().bold(projectName)}`,
    );
    return context;
  } catch (err) {
    await checkSpinner.stop();
    throw err;
  }
}

export async function validateProjectExists(
  projectFolder: string,
): Promise<boolean> {
  try {
    await findProject(projectFolder);
    return true;
  } catch (err) {
    if (!(err instanceof CliError)) {
      throw err;
    }
    reportCliError(err);
    return false;
  }
}
