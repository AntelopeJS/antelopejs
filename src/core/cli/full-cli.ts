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
import { applyHelpConventions, formatExamples, type HelpExample } from "./help";
import { reportAvailableUpdate, startUpdateCheck } from "./version-check";
import { formatOfficialPluginsHelp } from "./plugin-registry";
import {
  addChannelFilter,
  defaultConfigLogging,
  setupAntelopeProjectLogging,
} from "../../logging";

const HELP_COMMAND_NAME = "help";
const BARE_INVOCATION_ARGUMENT_COUNT = 2;
const DOCS_URL = "https://antelopejs.com/docs/cli/introduction";
const CLI_DESCRIPTION =
  "Build modular Node.js applications from explicit interfaces.";

const ROOT_EXAMPLES: HelpExample[] = [
  { description: "Create a project", command: "ajs project init my-app" },
  {
    description: "Add a module from npm",
    command: "ajs project modules add @antelopejs/api",
  },
  {
    description: "Run the project and reload it on changes",
    command: "ajs project dev --watch",
  },
];

function describeVersion(version: string): string {
  return `${getProcessPalette("result").bold(`AntelopeJS CLI v${version}`)}\n`;
}

function describeHelpFooter(): string {
  return (
    `\nPlugins:\n` +
    `${formatOfficialPluginsHelp()}\n` +
    `  Resolved from the nearest node_modules/.bin, then from PATH.\n\n` +
    `${formatExamples(ROOT_EXAMPLES)}\n\n` +
    `Run ajs <command> --help for details. Docs: ${DOCS_URL}`
  );
}

export function createCLI(version: string) {
  const program = new Command()
    .name("ajs")
    .description(CLI_DESCRIPTION)
    .version(version, "-v, --version", "Print the version")
    .addOption(Options.verbose)
    .addOption(Options.noColor)
    .addCommand(cmdProject())
    .addCommand(cmdModule())
    .addCommand(cmdConfig())
    .addCommand(cmdUpdate())
    .addCommand(cmdPlugins())
    .addHelpText("before", describeVersion(version))
    .addHelpText("after", describeHelpFooter());
  applyHelpConventions(program);
  return program;
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
