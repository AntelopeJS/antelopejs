import chalk from 'chalk';
import { Command, Option } from 'commander';
import { Options, readConfig } from '../../common';
import startAntelope, { LaunchOptions } from '../../../..';
import { Spinner, displayBox, info, warning, error } from '../../cli-ui';
import { fork } from 'child_process';
import path from 'path';
import fs, { unlinkSync, writeFileSync } from 'fs';
import { ModuleCache } from '../../../module-cache';

interface RunOptions extends LaunchOptions {
  project: string;
  env?: string;
  inspect?: string | boolean;
  interactive?: boolean;
  verbose?: string[];
}

interface RunnerEnv extends NodeJS.ProcessEnv {
  ANTELOPE_PROJECT_PATH: string;
  ANTELOPE_ENV?: string;
  ANTELOPE_WATCH: string;
  ANTELOPE_CONCURRENCY: string;
  ANTELOPE_VERBOSE?: string;
}

const DEFAULT_ENV = 'default';
const DEFAULT_PROJECT_NAME = 'unnamed';
const DEFAULT_INSPECTOR = '--inspect';
const RUNNER_PREFIX = 'antelope-runner-';

async function validateAndLoadProject(options: RunOptions): Promise<boolean> {
  const checkSpinner = new Spinner(`Looking for AntelopeJS project at ${chalk.cyan(options.project)}`);
  await checkSpinner.start();

  const config = await readConfig(options.project);
  if (!config) {
    await checkSpinner.fail(`No project found at ${chalk.bold(options.project)}`);
    console.log(`Run ${chalk.cyan.bold(`ajs project init <project-name>`)} to create a new project.`);
    process.exitCode = 1;
    return false;
  }

  const projectName = config.name || DEFAULT_PROJECT_NAME;
  await checkSpinner.succeed(`Found project: ${chalk.green.bold(projectName)}`);
  return true;
}

async function showRunConfiguration(options: RunOptions): Promise<void> {
  const inspector = options.inspect ? (options.inspect === true ? '127.0.0.1:9229' : options.inspect) : 'disabled';
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

function buildRunnerEnv(options: RunOptions): RunnerEnv {
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

async function launchWithInspector(options: RunOptions): Promise<void> {
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

async function launchDirect(options: RunOptions): Promise<void> {
  await startAntelope(options.project, options.env, options);
}

export default function () {
  return new Command('run')
    .description(
      `Run your AntelopeJS project\n` +
        `Starts your application by loading and connecting all modules defined in your project.`,
    )
    .addOption(Options.project)
    .addOption(Options.verbose)
    .addOption(
      new Option('-e, --env <environment>', 'Environment to use (development, production, etc.)').env(
        'ANTELOPEJS_LAUNCH_ENV',
      ),
    )
    .addOption(new Option('-w, --watch', 'Watch for changes and automatically restart'))
    .addOption(new Option('-c, --concurrency <number>', 'Number of modules to load concurrently').argParser(parseInt))
    .addOption(new Option('--inspect [host:port]', 'Enable inspector on host:port (default: 127.0.0.1:9229)'))
    .addOption(new Option('-i, --interactive', 'Run a REPL with the project'))
    .action(async function (this: Command, options: RunOptions) {
      const inheritedVerbose = this.parent?.parent?.getOptionValue('verbose') as string[] | undefined;
      const runOptions: RunOptions = {
        ...options,
        verbose: options.verbose ?? inheritedVerbose,
      };
      console.log('');

      const hasProject = await validateAndLoadProject(runOptions);
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
    });
}
