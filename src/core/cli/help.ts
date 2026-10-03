import type { Command } from "commander";

export interface HelpExample {
  description: string;
  command: string;
}

const HELP_FLAGS = "-h, --help";
const HELP_DESCRIPTION = "Show help for a command";
const HELP_COMMAND = "help [command]";
const EXAMPLES_TITLE = "Examples:";
const EXAMPLE_INDENT = "  ";
const COMMENT_PREFIX = "# ";
const PROMPT_PREFIX = "$ ";

function formatExample(example: HelpExample): string[] {
  return [
    `${EXAMPLE_INDENT}${COMMENT_PREFIX}${example.description}`,
    `${EXAMPLE_INDENT}${PROMPT_PREFIX}${example.command}`,
  ];
}

/**
 * Renders the `Examples:` block of a help page: each example as a shell
 * comment describing it, followed by the command to run.
 */
export function formatExamples(examples: HelpExample[]): string {
  return [EXAMPLES_TITLE, ...examples.flatMap(formatExample)].join("\n");
}

/**
 * Appends an `Examples:` block to the help page of the command.
 */
export function withExamples(
  command: Command,
  examples: HelpExample[],
): Command {
  return command.addHelpText("after", `\n${formatExamples(examples)}`);
}

/**
 * Applies the same help conventions to the command and all its subcommands:
 * the wording of `--help` and of the `help` command, and the global options
 * listed on every help page.
 */
export function applyHelpConventions(command: Command): void {
  command
    .helpOption(HELP_FLAGS, HELP_DESCRIPTION)
    .configureHelp({ showGlobalOptions: true });
  if (command.commands.length > 0) {
    command.helpCommand(HELP_COMMAND, HELP_DESCRIPTION);
  }
  command.commands.forEach(applyHelpConventions);
}
