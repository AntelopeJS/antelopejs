import chalk from "chalk";
import { Command } from "commander";

import { Options } from "./common";
import { displayBanner } from "./cli-ui";
import cmdConfig from "./commands/config";
import cmdModule from "./commands/module";
import cmdUpdate from "./commands/update";
import cmdPlugins from "./commands/plugins";
import cmdProject from "./commands/project";
import { getCoreVersion } from "./core-version";
import { warnIfOutdated } from "./version-check";
import { formatOfficialPluginsHelp } from "./plugin-registry";
import {
  addChannelFilter,
  defaultConfigLogging,
  setupAntelopeProjectLogging,
} from "../../logging";

const HELP_COMMAND_NAME = "help";

export function createCLI(version: string) {
  return new Command()
    .name("ajs")
    .description(
      chalk.bold` AntelopeJS CLI v${version} \n` +
        `Create modular Node.js applications with a clean interface-based architecture.\n\n` +
        chalk.yellow`Commands:\n` +
        `  project    Create and manage AntelopeJS projects\n` +
        `  module     Work with individual modules and their interfaces\n` +
        `  config     Configure CLI settings\n` +
        `  update     Update the CLI and its official plugins\n` +
        `  plugins    List official plugins\n\n` +
        chalk.yellow`Plugins:\n` +
        `${formatOfficialPluginsHelp()}\n` +
        `  Resolved from the nearest node_modules/.bin, then from PATH.\n\n` +
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
    .addCommand(cmdUpdate())
    .addCommand(cmdPlugins())
    .helpCommand(`${HELP_COMMAND_NAME} [command]`, `Display help for command`);
}

export function coreCommandNames(
  program: Command = createCLI(getCoreVersion()),
): string[] {
  return [
    HELP_COMMAND_NAME,
    ...program.commands.flatMap((command) => [
      command.name(),
      ...command.aliases(),
    ]),
  ];
}

// Main CLI function
export const runCLI = async () => {
  try {
    const version = getCoreVersion();

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
