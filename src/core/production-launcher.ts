#!/usr/bin/env node

import path from "node:path";
import { parseArgs } from "node:util";
import * as core from "..";

interface ProductionLauncherOptions {
  concurrency?: number;
  env: string;
  help: boolean;
  project: string;
  verbose?: string[];
}

const HELP = `Usage: ajs-start [options]

Start an AntelopeJS project from .antelope/build/build.json without loading
the development CLI or checking the npm registry.

Options:
  -p, --project <path>       Path to the AntelopeJS project
  -e, --env <environment>   Runtime environment (default: default)
  -c, --concurrency <count> Number of modules to load concurrently
      --verbose <channels>  Comma-separated TRACE log channels
  -h, --help                Display help
`;

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

export function parseProductionLauncherArgs(
  args: string[],
): ProductionLauncherOptions {
  const { values } = parseArgs({
    args,
    options: {
      project: { type: "string", short: "p" },
      env: { type: "string", short: "e" },
      concurrency: { type: "string", short: "c" },
      verbose: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  return {
    project: path.resolve(
      values.project ?? process.env.ANTELOPEJS_PROJECT ?? process.cwd(),
    ),
    env: values.env ?? process.env.ANTELOPEJS_LAUNCH_ENV ?? core.DEFAULT_ENV,
    concurrency: parseConcurrency(values.concurrency),
    verbose: parseVerbose(values.verbose ?? process.env.ANTELOPEJS_VERBOSE),
    help: values.help ?? false,
  };
}

export async function runProductionLauncher(args: string[]): Promise<void> {
  const options = parseProductionLauncherArgs(args);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  await core.launchFromBuild(options.project, options.env, {
    concurrency: options.concurrency,
    verbose: options.verbose,
  });
}

if (require.main === module) {
  runProductionLauncher(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  });
}
