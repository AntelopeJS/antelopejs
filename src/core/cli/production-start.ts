import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_ENV } from "../config/config-paths";
import { launchFromBuild } from "../runtime/project-launch";

export interface ProductionStartOptions {
  concurrency?: number;
  env: string;
  help: boolean;
  project: string;
  verbose?: string[];
}

const HELP = `Usage: ajs project start [options]

Start an AntelopeJS project from .antelope/build/build.json without loading
the development CLI or checking the npm registry.

Options:
  -p, --project <path>       Path to the AntelopeJS project
  -e, --env <environment>   Runtime environment (default: default)
  -c, --concurrency <count> Number of modules to load concurrently
      --verbose [channels]  TRACE logging, optionally scoped by comma-separated channels
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

function normalizeVerboseArgument(args: string[]): string[] {
  const verboseIndex = args.indexOf("--verbose");
  if (verboseIndex < 0) {
    return args;
  }
  const value = args[verboseIndex + 1];
  const normalizedValue = value?.startsWith("-") ? undefined : value;
  return [
    ...args.slice(0, verboseIndex),
    `--verbose=${normalizedValue ?? "*"}`,
    ...args.slice(verboseIndex + (normalizedValue ? 2 : 1)),
  ];
}

export function parseProductionStartArgs(
  args: string[],
): ProductionStartOptions {
  const { values } = parseArgs({
    args: normalizeVerboseArgument(args),
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
    env: values.env ?? process.env.ANTELOPEJS_LAUNCH_ENV ?? DEFAULT_ENV,
    concurrency: parseConcurrency(values.concurrency),
    verbose: parseVerbose(values.verbose ?? process.env.ANTELOPEJS_VERBOSE),
    help: values.help ?? false,
  };
}

export async function startFromBuild(
  options: ProductionStartOptions,
): Promise<void> {
  await launchFromBuild(options.project, options.env, {
    concurrency: options.concurrency,
    verbose: options.verbose,
  });
}

export async function runProductionStart(args: string[]): Promise<void> {
  const options = parseProductionStartArgs(args);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  await startFromBuild(options);
}
