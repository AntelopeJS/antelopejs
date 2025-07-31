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
import { setVerboseSections, VERBOSE_SECTIONS, VerboseSection } from '../logging';
import setupAntelopeProjectLogging from '../logging';
import { defaultConfigLogging } from '../logging';

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
const version = packageJson.version;

/**
 * Parse the verbose sections from the --verbose option
 * All sections are enabled by default
 * @param verboseOption - The value of the --verbose option
 * @returns The list of sections to enable
 */
function parseVerboseSections(verboseOption?: string): VerboseSection[] | undefined {
  if (!verboseOption) {
    return undefined;
  }

  const sections = verboseOption
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const validSections = Object.values(VERBOSE_SECTIONS);
  const invalidSections = sections.filter((section) => !validSections.includes(section as VerboseSection));

  if (invalidSections.length > 0) {
    throw new Error(
      `Sections verbose invalides: ${invalidSections.join(', ')}. Sections valides: ${validSections.join(', ')}`,
    );
  }

  return sections as VerboseSection[];
}

function parseVerboseOptionEarly(): string | undefined {
  const args = process.argv.slice(2);
  const verboseIndex = args.findIndex((arg) => arg.startsWith('--verbose'));

  if (verboseIndex === -1) {
    return undefined;
  }

  const verboseArg = args[verboseIndex];
  if (verboseArg === '--verbose') {
    if (verboseIndex + 1 < args.length && !args[verboseIndex + 1].startsWith('-')) {
      return args[verboseIndex + 1];
    }
    return '';
  }

  const equalIndex = verboseArg.indexOf('=');
  if (equalIndex !== -1) {
    return verboseArg.substring(equalIndex + 1);
  }

  return undefined;
}

// Main CLI function
const runCLI = async () => {
  try {
    // Configure verbose logging early based on command line arguments
    const verboseOption = parseVerboseOptionEarly();
    if (verboseOption !== undefined) {
      const sections = parseVerboseSections(verboseOption);
      setVerboseSections(sections);
    }

    // Initialize logging with default configuration
    const defaultConfig = {
      logging: defaultConfigLogging,
      cacheFolder: '.antelopejs',
      modules: {},
      name: 'cli',
      envOverrides: {},
      disabledExports: [],
    };
    setupAntelopeProjectLogging(defaultConfig);

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
        '--verbose [=sections]',
        `Enable verbose logging for specific sections (comma-separated). ` +
          `Sections: ${Object.values(VERBOSE_SECTIONS).join(', ')}. ` +
          `Default: all sections enabled. Example: --verbose=cmd,git,package`,
      )
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
  // Don't show error messages for ExitPromptError
  if (err && typeof err === 'object' && 'name' in err && err.name === 'ExitPromptError') {
    process.exit(0);
  }

  console.error(chalk.red('Error:'), err.message || err);
  process.exit(1);
});
