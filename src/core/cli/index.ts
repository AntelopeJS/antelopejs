#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import {
  addChannelFilter,
  defaultConfigLogging,
  setupAntelopeProjectLogging,
} from "../../logging";
import { displayBanner } from "./cli-ui";
import cmdConfig from "./commands/config";
import cmdModule from "./commands/module";
import cmdProject from "./commands/project";
import { Options } from "./common";
import { warnIfOutdated } from "./version-check";

export function createCLI(version: string) {
  return new Command()
    .name("ajs")
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
    .version(version, "-v, --version", "Display CLI version number")
    .addOption(Options.verbose)
    .addCommand(cmdProject())
    .addCommand(cmdModule())
    .addCommand(cmdConfig())
    .helpCommand("help [command]", `Display help for command`);
}

// Main CLI function
export const runCLI = async () => {
  try {
    // Read version from package.json
    const packageJson = JSON.parse(
      readFileSync(join(__dirname, "../../../package.json"), "utf8"),
    );
    const version = packageJson.version;

    // Initialize logging with default configuration
    setupAntelopeProjectLogging(defaultConfigLogging);

    // Check for updates before anything else
    await warnIfOutdated(version);

    // Display fancy banner when no arguments are passed
    if (process.argv.length <= 2) {
      displayBanner("AntelopeJS");
    }

    const program = createCLI(version);

    // Parse arguments
    await program.parseAsync();

    const verbose = program.getOptionValue("verbose");
    if (verbose) {
      for (const channel of verbose as string[]) {
        addChannelFilter(channel, 0);
      }
    }
  } catch (error) {
    // Check if the error is ExitPromptError from inquirer (thrown when Ctrl+C is pressed)
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "ExitPromptError"
    ) {
      process.exit(0);
    }

    // Re-throw any other errors
    throw error;
  }
};

if (require.main === module) {
  runCLI().catch((err) => {
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      err.name === "ExitPromptError"
    ) {
      process.exit(0);
    }

    console.error(
      chalk.red("Error:"),
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
    process.exit(1);
  });
}
