#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';

import cmdProject from './project';
import cmdModule from './module';
import cmdConfig from './config';
import { displayBanner } from '../utils/cli-ui';
import { warnIfOutdated } from './version-check';
import { setupAntelopeProjectLogging, defaultConfigLogging, addChannelFilter } from '../logging';

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
const version = packageJson.version;

// Main CLI function
const runCLI = async () => {
  try {
    // Initialize logging with default configuration
    setupAntelopeProjectLogging(defaultConfigLogging);

    // Check for updates before anything else
    await warnIfOutdated(version);

    // Display fancy banner when no arguments are passed
    if (process.argv.length <= 2) {
      displayBanner('AntelopeJS');
    }

    const program = new Command()
      .name('ajs')
      .description(
        chalk.bold` AntelopeJS CLI v${version} \n` +
          `Create modular Node.js applications with a clean interface-based architecture.\n\n` +
          chalk.yellow`Commands:\n` +
          `  project    Create and manage AntelopeJS projects\n` +
          `  module     Work with individual modules and their interfaces\n` +
          `  config     Configure CLI settings\n\n` +
          chalk.yellow`Examples:\n` +
          `  $ ajs project init my-app         Create a new project\n` +
          `  $ ajs module init my-module       Create a new module\n` +
          `  $ ajs project run --watch         Run with auto-reload`,
      )
      .version(version, '-v, --version', 'Display CLI version number')
      .option(
        '--verbose [=cahnnels]',
        `Enable verbose logging (TRACE level) for specific log channels (comma-separated).`,
      )
      .addCommand(cmdProject())
      .addCommand(cmdModule())
      .addCommand(cmdConfig())
      .helpCommand('help [command]', `Display help for command`);

    // Parse arguments
    await program.parseAsync();

    const verbose = program.getOptionValue('verbose');
    if (verbose) {
      for (const channel of verbose.split(',')) {
        addChannelFilter(channel, 0);
      }
    }
  } catch (error) {
    // Check if the error is ExitPromptError from inquirer (thrown when Ctrl+C is pressed)
    if (error && typeof error === 'object' && 'name' in error && error.name === 'ExitPromptError') {
      process.exit(0);
    }

    // Re-throw any other errors
    throw error;
  }
};

// Handle process termination signals
process.on('SIGINT', () => {
  process.exit(0);
});

// Run the CLI
runCLI().catch((err) => {
  // Don't show error messages for ExitPromptError
  if (err && typeof err === 'object' && 'name' in err && err.name === 'ExitPromptError') {
    process.exit(0);
  }

  console.error(chalk.red('Error:'), err.message || err);
  process.exit(1);
});
