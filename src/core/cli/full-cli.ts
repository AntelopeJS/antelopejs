import { Command } from "commander";

import { Options } from "./options";
import { getProcessPalette } from "./output";
import cmdConfig from "./commands/config";
import cmdModule from "./commands/module";
import cmdUpdate from "./commands/update";
import cmdPlugins from "./commands/plugins";
import cmdProject from "./commands/project";
import { getCoreVersion } from "./core-version";
import { formatUsageErrors } from "./usage-errors";
import { reportAvailableUpdate, startUpdateCheck } from "./version-check";
import { formatOfficialPluginsHelp } from "./plugin-registry";
import {
  addChannelFilter,
  defaultConfigLogging,
  setupAntelopeProjectLogging,
} from "../../logging";

const HELP_COMMAND_NAME = "help";
const BARE_INVOCATION_ARGUMENT_COUNT = 2;

function describeCLI(version: string): string {
  const palette = getProcessPalette("result");
  return (
    `${palette.bold(`AntelopeJS CLI v${version}`)}\n` +
    `Create modular Node.js applications with a clean interface-based architecture.\n\n` +
    `${palette.bold("Commands:")}\n` +
    `  project    Create and manage AntelopeJS projects\n` +
    `  module     Work with individual modules and their interfaces\n` +
    `  config     Configure CLI settings\n` +
    `  update     Update the CLI and its official plugins\n` +
    `  plugins    List official plugins\n\n` +
    `${palette.bold("Plugins:")}\n` +
    `${formatOfficialPluginsHelp()}\n` +
    `  Resolved from the nearest node_modules/.bin, then from PATH.\n\n` +
    `${palette.bold("Examples:")}\n` +
    `  $ ajs project init my-app         Create a new project\n` +
    `  $ ajs module init my-module       Create a new module\n` +
    `  $ ajs project run --watch         Run with auto-reload`
  );
}

export function createCLI(version: string) {
  return new Command()
    .name("ajs")
    .description(describeCLI(version))
    .version(version, "-v, --version", "Display CLI version number")
    .addOption(Options.verbose)
    .addOption(Options.noColor)
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

function isBareInvocation(): boolean {
  return process.argv.length <= BARE_INVOCATION_ARGUMENT_COUNT;
}

async function runProgram(program: Command): Promise<void> {
  if (isBareInvocation()) {
    program.outputHelp();
    return;
  }
  await program.parseAsync();
  applyVerboseChannels(program);
}

// Main CLI function
export const runCLI = async () => {
  const updateCheck = startUpdateCheck();
  try {
    const version = getCoreVersion();

    // Initialize logging with default configuration
    setupAntelopeProjectLogging(defaultConfigLogging);

    const program = createCLI(version);
    formatUsageErrors(program);
    await runProgram(program);
    await reportAvailableUpdate(version, updateCheck);
  } finally {
    updateCheck?.cancel();
  }
};
