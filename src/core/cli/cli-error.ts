import chalk from "chalk";

import { error } from "./cli-ui";
import { FAILURE_EXIT_CODE } from "./exit-codes";

export interface CliProblem {
  title: string;
  reason?: string;
  fixes?: string[];
  exitCode?: number;
}

const CLI_ERROR_NAME = "CliError";
const DETAIL_INDENT = "  ";

/**
 * A failure the command can explain to the user: what failed, why, and how to
 * fix it. Thrown by commands, reported once by the CLI entry point with its
 * exit code.
 */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(readonly problem: CliProblem) {
    super(problem.title);
    this.name = CLI_ERROR_NAME;
    this.exitCode = problem.exitCode ?? FAILURE_EXIT_CODE;
  }
}

export function reportCliError(cliError: CliError): void {
  const { title, reason, fixes = [] } = cliError.problem;
  error(title);
  if (reason) {
    console.error(`${DETAIL_INDENT}${chalk.dim(reason)}`);
  }
  fixes.forEach((fix) =>
    console.error(`${DETAIL_INDENT}${chalk.cyan("→")} ${fix}`),
  );
  process.exitCode = cliError.exitCode;
}
