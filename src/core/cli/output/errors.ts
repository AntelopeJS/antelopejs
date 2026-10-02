import { FAILURE_EXIT_CODE } from "../exit-codes";
import type { CliProblem, Ui } from "./types";
import { getProcessUi } from "./ui";

const CLI_ERROR_NAME = "CliError";

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
