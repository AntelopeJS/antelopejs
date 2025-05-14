import chalk from 'chalk';
import { Command, Option } from 'commander';
import { Options, readConfig } from '../common';
import startAntelope, { LaunchOptions } from '../..';
import { Spinner, displayBox, info, warning, error, sleep } from '../../utils/cli-ui';
import { fork } from 'child_process';
import path from 'path';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';

interface RunOptions extends LaunchOptions {
  project: string;
  env?: string;
  inspect?: string | boolean;
}

export default function () {
  return new Command('run')
    .description(
      `Run your AntelopeJS project\n` +
        `Starts your application by loading and connecting all modules defined in your project.`,
    )
    .addOption(Options.project)
    .addOption(
      new Option('-e, --env <environment>', 'Environment to use (development, production, etc.)').env(
        'ANTELOPEJS_LAUNCH_ENV',
      ),
    )
    .addOption(new Option('-w, --watch', 'Watch for changes and automatically restart'))
    .addOption(new Option('-c, --concurrency <number>', 'Number of modules to load concurrently').argParser(parseInt))
    .addOption(new Option('--inspect [host:port]', 'Enable inspector on host:port (default: 127.0.0.1:9229)'))
    .action(async (options: RunOptions) => {
      console.log(''); // Add spacing for readability

      // Check if project exists
      const checkSpinner = new Spinner(`Looking for AntelopeJS project at ${chalk.cyan(options.project)}`);
      await checkSpinner.start();

      const config = await readConfig(options.project);
      if (!config) {
        await checkSpinner.fail(`No project found at ${chalk.bold(options.project)}`);
        console.log(`Run ${chalk.cyan.bold(`ajs project init <project-name>`)} to create a new project.`);
        return;
      }

      const projectName = config.name || 'unnamed';
      await checkSpinner.succeed(`Found project: ${chalk.green.bold(projectName)}`);

      // Display run configuration
      console.log('');
      await displayBox(
        `Environment: ${chalk.cyan(options.env || 'default')}\n` +
          `Watch mode: ${options.watch ? chalk.green('enabled') : chalk.gray('disabled')}\n` +
          `Inspector: ${options.inspect ? chalk.green(options.inspect === true ? '127.0.0.1:9229' : options.inspect) : chalk.gray('disabled')}`,
        ' Launch Configuration',
        { padding: 1 },
      );

      // Show info about watch mode if enabled
      if (options.watch) {
        console.log('');
        warning(`Watch mode enabled - project will automatically restart when files change`);
      }

      // Start the project with a spinner
      console.log('');
      info(`Starting AntelopeJS project`);

      try {
        if (options.inspect) {
          // Run in a separate process with inspect flag
          const inspectArg = options.inspect === true ? '--inspect' : `--inspect=${options.inspect}`;

          // Define the startup script directly with the runner code
          const runnerScript = `
            require('${path.resolve(__dirname, '../..')}').default(
              process.env.ANTELOPE_PROJECT_PATH,
              process.env.ANTELOPE_ENV,
              {
                watch: process.env.ANTELOPE_WATCH === 'true',
                concurrency: process.env.ANTELOPE_CONCURRENCY ? parseInt(process.env.ANTELOPE_CONCURRENCY, 10) : undefined
              }
            ).catch(err => {
              console.error('Error running AntelopeJS:', err instanceof Error ? err.message : String(err));
              process.exit(1);
            });
          `;

          // Create a temporary runner file
          const tmpDir = path.resolve(options.project, '.antelope/tmp');
          const runnerPath = path.resolve(tmpDir, `antelope-runner-${Date.now()}.js`);

          // Ensure tmp directory exists
          if (!existsSync(tmpDir)) {
            mkdirSync(tmpDir, { recursive: true });
          }

          // Write the runner script to a file
          writeFileSync(runnerPath, runnerScript);

          // Fork a new Node process with the inspect option
          const child = fork(runnerPath, [], {
            stdio: 'inherit',
            execArgv: [inspectArg],
            env: {
              ...process.env,
              ANTELOPE_PROJECT_PATH: options.project,
              ANTELOPE_ENV: options.env,
              ANTELOPE_WATCH: options.watch ? 'true' : 'false',
              ANTELOPE_CONCURRENCY: options.concurrency?.toString() || '',
            },
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

          await sleep(1000);
          unlinkSync(runnerPath);
        } else {
          // Run in the current process as before
          await startAntelope(options.project, options.env, options);
        }
      } catch (err) {
        if (err instanceof Error) {
          error(err.message);
        } else {
          error(`Unknown error: ${String(err)}`);
        }
        process.exit(1);
      }
    });
}
