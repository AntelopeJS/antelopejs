import { type Command, CommanderError } from "commander";

import { USAGE_EXIT_CODE } from "./exit-codes";
import { CliError, type CliProblem } from "./output";

const COMMANDER_ERROR_PREFIX = /^error:\s*/;
const COMMANDER_NOTE_PATTERN = /^\((.*)\)$/;
const LINE_BREAK = "\n";
const HELP_OUTPUT_CODES = new Set([
  "commander.help",
  "commander.helpDisplayed",
  "commander.version",
]);

function commandPath(command: Command): string {
  return command.parent
    ? `${commandPath(command.parent)} ${command.name()}`
    : command.name();
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * Rewrites one of commander's usage errors (`error: unknown option '--x'`,
 * optionally followed by a `(Did you mean …?)` note) as a problem: the error
 * as title, the command usage as reason, the suggestion and a `--help` hint
 * as fixes, with the usage exit code.
 */
function describeUsageError(message: string, command: Command): CliProblem {
  const [headline, ...notes] = message.trim().split(LINE_BREAK);
  const path = commandPath(command);
  return {
    title: capitalize(headline.replace(COMMANDER_ERROR_PREFIX, "")),
    reason: `Usage: ${path} ${command.usage()}`,
    fixes: [
      ...notes.map((note) => note.replace(COMMANDER_NOTE_PATTERN, "$1")),
      `Run ${path} --help for usage`,
    ],
    exitCode: USAGE_EXIT_CODE,
  };
}

function toUsageFailure(error: CommanderError, command: Command): Error {
  if (HELP_OUTPUT_CODES.has(error.code)) {
    return error;
  }
  return new CliError(describeUsageError(error.message, command));
}

function silenceCommanderError(): void {}

/**
 * Makes commander throw instead of exiting, for the command and all its
 * subcommands, and turns usage errors into {@link CliError}s so the error
 * boundary prints them with the same template as every other failure.
 */
export function formatUsageErrors(command: Command): void {
  command
    .exitOverride((error) => {
      throw toUsageFailure(error, command);
    })
    .configureOutput({ outputError: silenceCommanderError });
  command.commands.forEach(formatUsageErrors);
}
