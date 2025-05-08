#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';

import cmdProject from './project';
import cmdModule from './module';
import cmdConfig from './config';
import { displayBanner, sleep } from '../utils/cli-ui';

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
const version = packageJson.version;

// Main CLI function
const runCLI = async () => {
  try {
    // Display fancy banner when no arguments are passed
    if (process.argv.length <= 2) {
      console.clear();
      displayBanner('AntelopeJS');
      // Wait a moment to let the user see the banner
      await sleep(500);
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
      .addCommand(cmdProject())
      .addCommand(cmdModule())
      .addCommand(cmdConfig())
      .helpCommand('help [command]', `Display help for command`);

    // Parse arguments
    await program.parseAsync();
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
  // Only show error messages for errors other than ExitPromptError
  if (err && typeof err === 'object' && 'name' in err && err.name !== 'ExitPromptError') {
    console.clear();
    console.error(chalk.red('Error:'), err.message || err);
    process.exit(1);
  }
  process.exit(0);
});
