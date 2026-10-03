import { CANCELLED_ERROR_NAME, CANCELLED_MESSAGE } from "../cancellation";
import { FAILURE_EXIT_CODE, USAGE_EXIT_CODE } from "../exit-codes";
import type { CliProblem, MissingInput, Ui } from "./types";
import { getProcessUi } from "./ui";

const CLI_ERROR_NAME = "CliError";
const NEEDS_INPUT_ERROR_NAME = "NeedsInputError";
const NEEDS_INPUT_TITLE = "Cannot prompt: this is not an interactive terminal";

/**
 * A failure the command can explain to the user: what failed, why, and how to
 * fix it. Thrown by commands, reported once by the CLI entry point with its
 * exit code. Pass the low-level failure as `cause` so `--verbose` can show
 * its output or stack.
 */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(
    readonly problem: CliProblem,
    options?: ErrorOptions,
  ) {
    super(problem.title, options);
    this.name = CLI_ERROR_NAME;
    this.exitCode = problem.exitCode ?? FAILURE_EXIT_CODE;
  }
}

export function reportCliError(
  cliError: CliError,
  ui: Ui = getProcessUi(),
): void {
  ui.problem(cliError.problem);
  process.exitCode = cliError.exitCode;
}

function joinCommand(parts: string[]): string {
  return parts.filter((part) => part !== "").join(" ");
}

const INTERACTIVE_TERMINAL_FIX = "Run it again in an interactive terminal";

function defaultFixes(input: MissingInput): string[] {
  if (input.flags.length === 0) {
    return [INTERACTIVE_TERMINAL_FIX];
  }
  const isSingle = input.flags.length === 1;
  const passFlags = `Pass ${isSingle ? "it as a flag" : "them as flags"}: ${joinCommand([input.command, ...input.flags])}`;
  const acceptDefaults =
    input.defaultsFlag && !input.flags.includes(input.defaultsFlag)
      ? [
          `Or accept the defaults: ${joinCommand([input.command, input.defaultsFlag])}`,
        ]
      : [];
  return [passFlags, ...acceptDefaults];
}

/**
 * Describes answers a command needs and cannot ask for: what to pass on the
 * command line instead of answering a prompt.
 */
export function describeMissingInput(input: MissingInput): CliProblem {
  const answers = input.flags.length > 1 ? "answers" : "an answer";
  return {
    title: NEEDS_INPUT_TITLE,
    reason: `${input.command} needs ${answers} it cannot ask for when stdin is not a terminal or CI is set.`,
    fixes: input.fixes ?? defaultFixes(input),
    exitCode: USAGE_EXIT_CODE,
  };
}

/**
 * Thrown instead of opening a prompt when nobody can answer it: standard
 * input is not a terminal, or the run is in CI. Names the flags that answer
 * the questions, and exits with the usage exit code.
 */
export class NeedsInputError extends CliError {
  constructor(input: MissingInput) {
    super(describeMissingInput(input));
    this.name = NEEDS_INPUT_ERROR_NAME;
  }
}

/**
 * Thrown when the user cancels a prompt (Ctrl+C or Escape). The CLI reports
 * it as `Cancelled` with the cancelled exit code.
 */
export class CancelledError extends Error {
  constructor() {
    super(CANCELLED_MESSAGE);
    this.name = CANCELLED_ERROR_NAME;
  }
}
