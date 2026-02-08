import chalk from 'chalk';
import { fork } from 'child_process';
import fs, { unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import { Command, Option } from 'commander';
import startAntelope, { LaunchOptions, DEFAULT_ENV } from '../../../..';
import { ModuleCache } from '../../../module-cache';
import { Options } from '../../common';
import { displayBox, error, info, warning } from '../../cli-ui';
import { resolveInheritedVerbose, validateProjectExists } from '../shared/project-command';

interface RunnerEnv extends NodeJS.ProcessEnv {
  ANTELOPE_PROJECT_PATH: string;
  ANTELOPE_ENV?: string;
  ANTELOPE_WATCH: string;
  ANTELOPE_CONCURRENCY: string;
  ANTELOPE_VERBOSE?: string;
}

export interface DevCommandOptions extends LaunchOptions {
  project: string;
  env?: string;
  inspect?: string | boolean;
  interactive?: boolean;
  verbose?: string[];
}

const DEFAULT_INSPECTOR = '--inspect';
const RUNNER_PREFIX = 'antelope-runner-';
const DEFAULT_INSPECT_HOST = '127.0.0.1:9229';

const ENV_OPTION = new Option('-e, --env <environment>', 'Environment to use (development, production, etc.)').env(
  'ANTELOPEJS_LAUNCH_ENV',
);
const WATCH_OPTION = new Option('-w, --watch', 'Watch for changes and automatically restart');
const CONCURRENCY_OPTION = new Option('-c, --concurrency <number>', 'Number of modules to load concurrently').argParser(
  parseInt,
);
const INSPECT_OPTION = new Option('--inspect [host:port]', 'Enable inspector on host:port (default: 127.0.0.1:9229)');
const INTERACTIVE_OPTION = new Option('-i, --interactive', 'Run a REPL with the project');

interface DevCommandDefinition {
  name: string;
  description: string;
}

const DEV_COMMAND_DEFINITION: DevCommandDefinition = {
  name: 'dev',
  description:
    `Run your AntelopeJS project in development mode\n` +
    `Starts your application by loading and connecting all modules defined in your project.`,
};

export function withDevCommandOptions(command: Command): Command {
  return command
    .addOption(Options.project)
    .addOption(Options.verbose)
    .addOption(ENV_OPTION)
    .addOption(WATCH_OPTION)
    .addOption(CONCURRENCY_OPTION)
    .addOption(INSPECT_OPTION)
    .addOption(INTERACTIVE_OPTION);
}

function resolveInspectLabel(options: DevCommandOptions): string {
  if (!options.inspect) {
    return 'disabled';
  }
  return options.inspect === true ? DEFAULT_INSPECT_HOST : options.inspect;
}

async function showRunConfiguration(options: DevCommandOptions): Promise<void> {
  const inspector = resolveInspectLabel(options);
  await displayBox(
    `Environment: ${chalk.cyan(options.env || DEFAULT_ENV)}\n` +
      `Watch mode: ${options.watch ? chalk.green('enabled') : chalk.gray('disabled')}\n` +
      `Inspector: ${options.inspect ? chalk.green(inspector) : chalk.gray(inspector)}`,
    ' Launch Configuration',
    { padding: 1 },
  );
}

function buildRunnerScript(entryPath: string): string {
  return `
    const entry = require(${JSON.stringify(entryPath)});
    const start = entry.default ?? entry;
    if (typeof start !== 'function') {
      throw new TypeError('Antelope entrypoint is not a function');
    }
    start(
      process.env.ANTELOPE_PROJECT_PATH,
      process.env.ANTELOPE_ENV,
      {
        watch: process.env.ANTELOPE_WATCH === 'true',
        concurrency: process.env.ANTELOPE_CONCURRENCY ? parseInt(process.env.ANTELOPE_CONCURRENCY, 10) : undefined,
        verbose: process.env.ANTELOPE_VERBOSE?.split(',') ?? undefined
      }
    ).catch(err => {
      console.error('Error running AntelopeJS:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
  `;
}

function buildRunnerEnv(options: DevCommandOptions): RunnerEnv {
  return {
    ...process.env,
    ANTELOPE_PROJECT_PATH: options.project,
    ANTELOPE_ENV: options.env,
    ANTELOPE_WATCH: options.watch ? 'true' : 'false',
    ANTELOPE_CONCURRENCY: options.concurrency?.toString() || '',
    ANTELOPE_VERBOSE: options.verbose?.join(','),
  };
}

async function cleanupRunner(tempDir: string, runnerPath: string): Promise<void> {
  unlinkSync(runnerPath);
  try {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  } catch {
    return;
  }
}

async function launchWithInspector(options: DevCommandOptions): Promise<void> {
  const inspectArg = options.inspect === true ? DEFAULT_INSPECTOR : `--inspect=${options.inspect}`;
  const entryPath = path.resolve(__dirname, '../../../..');
  const runnerScript = buildRunnerScript(entryPath);
  const tempDir = await ModuleCache.getTemp();
  const runnerPath = path.join(tempDir, `${RUNNER_PREFIX}${Date.now()}.js`);

  writeFileSync(runnerPath, runnerScript);

  const child = fork(runnerPath, [], {
    stdio: 'inherit',
    execArgv: [inspectArg],
    env: buildRunnerEnv(options),
  });
  child.on('error', () => {
    process.exit(1);
  });
  child.on('exit', (code) => {
    if (code !== 0) {
      process.exit(code || 1);
    }
    process.exit(0);
  });

  await cleanupRunner(tempDir, runnerPath);
}

async function launchDirect(options: DevCommandOptions): Promise<void> {
  await startAntelope(options.project, options.env, options);
}

function withCommandVerbose(command: Command, options: DevCommandOptions): DevCommandOptions {
  const inheritedVerbose = resolveInheritedVerbose(command, options.verbose);
  return {
    ...options,
    verbose: inheritedVerbose,
  };
}

export async function executeDevCommand(this: Command, options: DevCommandOptions): Promise<void> {
  const runOptions = withCommandVerbose(this, options);
  console.log('');

  const hasProject = await validateProjectExists(runOptions.project);
  if (!hasProject) {
    return;
  }

  console.log('');
  await showRunConfiguration(runOptions);

  if (runOptions.watch) {
    console.log('');
    warning(`Watch mode enabled - project will automatically restart when files change`);
  }

  console.log('');
  info(`Starting AntelopeJS project`);

  try {
    if (runOptions.inspect) {
      await launchWithInspector(runOptions);
      return;
    }
    await launchDirect(runOptions);
  } catch (err) {
    error(err instanceof Error ? err.message : `Unknown error: ${String(err)}`);
    process.exitCode = 1;
  }
}

export function createDevCommand(definition: DevCommandDefinition = DEV_COMMAND_DEFINITION): Command {
  const command = new Command(definition.name).description(definition.description);
  return withDevCommandOptions(command).action(executeDevCommand);
}

export default function () {
  return createDevCommand();
}
