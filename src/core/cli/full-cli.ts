import chalk from "chalk";
import { Command, CommanderError } from "commander";

import { Options } from "./common";
import { displayBanner } from "./cli-ui";
import cmdConfig from "./commands/config";
import cmdModule from "./commands/module";
import cmdUpdate from "./commands/update";
import cmdPlugins from "./commands/plugins";
import cmdProject from "./commands/project";
import { getCoreVersion } from "./core-version";
import { isPromptCancellation, reportCancellation } from "./cancellation";
import { CliError, reportCliError } from "./cli-error";
import { SUCCESS_EXIT_CODE, USAGE_EXIT_CODE } from "./exit-codes";
import { reportAvailableUpdate, startUpdateCheck } from "./version-check";
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

function applyVerboseChannels(program: Command): void {
  const verbose = program.getOptionValue("verbose");
  if (verbose) {
    for (const channel of verbose as string[]) {
      addChannelFilter(channel, 0);
    }
  }
}

function throwOnCommanderExit(command: Command): void {
  command.exitOverride();
  command.commands.forEach(throwOnCommanderExit);
}

function applyCommanderExitCode(error: CommanderError): void {
  process.exitCode =
    error.exitCode === SUCCESS_EXIT_CODE ? SUCCESS_EXIT_CODE : USAGE_EXIT_CODE;
}

// Main CLI function
export const runCLI = async () => {
  const updateCheck = startUpdateCheck();
  try {
    const version = getCoreVersion();

    // Initialize logging with default configuration
    setupAntelopeProjectLogging(defaultConfigLogging);

    // Display fancy banner when no arguments are passed
    if (process.argv.length <= 2) {
      displayBanner("AntelopeJS");
    }

    const program = createCLI(version);
    throwOnCommanderExit(program);

    // Parse arguments
    await program.parseAsync();

    applyVerboseChannels(program);
    await reportAvailableUpdate(version, updateCheck);
  } catch (error) {
    if (isPromptCancellation(error)) {
      reportCancellation();
      return;
    }
    if (error instanceof CommanderError) {
      applyCommanderExitCode(error);
      return;
    }
    if (error instanceof CliError) {
      reportCliError(error);
      return;
    }
    throw error;
  } finally {
    updateCheck?.cancel();
  }
};
