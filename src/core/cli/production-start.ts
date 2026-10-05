import path from "node:path";
import { parseArgs } from "node:util";

import {
  DEFAULT_ENV,
  LAUNCH_ENVIRONMENT_VARIABLE,
} from "../config/config-paths";
import { launchFromBuild } from "../runtime/project-launch";
import { findBuildModuleSetChange } from "../runtime/build-refresh";
import {
  BUILD_MODULE_SET_CHANGED_EXIT_CODE,
  FAILURE_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "./exit-codes";
import { normalizeVerboseArguments } from "./output/verbosity";

export interface ProductionStartOptions {
  concurrency?: number;
  env: string;
  project: string;
  refreshConfig: boolean;
  verbose?: string[];
}

function parseConcurrency(value?: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer");
  }
  return concurrency;
}

function parseVerbose(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }
  return value.replaceAll(/%/g, "*").split(",");
}

export function parseProductionStartArgs(
  args: string[],
): ProductionStartOptions {
  const { values } = parseArgs({
    args: normalizeVerboseArguments(args),
    options: {
      project: { type: "string", short: "p" },
      env: { type: "string", short: "e" },
      concurrency: { type: "string", short: "c" },
      verbose: { type: "string" },
      "refresh-config": { type: "boolean" },
    },
  });
  return {
    project: path.resolve(
      values.project ?? process.env.ANTELOPEJS_PROJECT ?? process.cwd(),
    ),
    env: values.env ?? process.env[LAUNCH_ENVIRONMENT_VARIABLE] ?? DEFAULT_ENV,
    concurrency: parseConcurrency(values.concurrency),
    verbose: parseVerbose(values.verbose ?? process.env.ANTELOPEJS_VERBOSE),
    refreshConfig: values["refresh-config"] ?? false,
  };
}

export async function startFromBuild(
  options: ProductionStartOptions,
): Promise<void> {
  await launchFromBuild(options.project, options.env, {
    concurrency: options.concurrency,
    verbose: options.verbose,
    refreshConfig: options.refreshConfig,
  });
}

/**
 * Exit code a failed `ajs project start` reports, telling a module set that
 * no longer matches the build apart from any other failure.
 */
export function startFailureExitCode(error: unknown): number {
  return findBuildModuleSetChange(error)
    ? BUILD_MODULE_SET_CHANGED_EXIT_CODE
    : FAILURE_EXIT_CODE;
}

function parseArgsOrReportUsage(
  args: string[],
): ProductionStartOptions | undefined {
  try {
    return parseProductionStartArgs(args);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = USAGE_EXIT_CODE;
    return undefined;
  }
}

export async function runProductionStart(args: string[]): Promise<void> {
  const options = parseArgsOrReportUsage(args);
  if (!options) {
    return;
  }
  try {
    await startFromBuild(options);
  } catch (error) {
    const moduleSetChange = findBuildModuleSetChange(error);
    if (!moduleSetChange) {
      throw error;
    }
    process.stderr.write(`${moduleSetChange.message}\n`);
    process.exitCode = BUILD_MODULE_SET_CHANGED_EXIT_CODE;
  }
}
