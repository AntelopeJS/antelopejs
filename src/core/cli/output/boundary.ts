import { CommanderError } from "commander";

import { isPromptCancellation, reportCancellation } from "../cancellation";
import {
  CANCELLED_EXIT_CODE,
  SUCCESS_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../exit-codes";
import { reportFailure } from "./failures";
import type { Ui } from "./types";

export interface BoundaryOptions {
  ui?: Ui;
  verbose?: boolean;
}

interface FailureHandler {
  matches(error: unknown): boolean;
  handle(error: unknown, options: BoundaryOptions): number;
}

function reportCancelledRun(): number {
  reportCancellation();
  return CANCELLED_EXIT_CODE;
}

function commanderExitCode(error: unknown): number {
  return (error as CommanderError).exitCode === SUCCESS_EXIT_CODE
    ? SUCCESS_EXIT_CODE
    : USAGE_EXIT_CODE;
}

const FAILURE_HANDLERS: FailureHandler[] = [
  { matches: isPromptCancellation, handle: reportCancelledRun },
  {
    matches: (error) => error instanceof CommanderError,
    handle: commanderExitCode,
  },
];

function handleFailure(error: unknown, options: BoundaryOptions): number {
  const handler = FAILURE_HANDLERS.find((candidate) =>
    candidate.matches(error),
  );
  return handler
    ? handler.handle(error, options)
    : reportFailure(error, options.ui, options.verbose);
}

/**
 * Runs the CLI and reports whatever it throws exactly once: a cancelled
 * prompt as `Cancelled` (exit 130), commander's help and version exits with
 * their own code, and every other failure with the what / why / fix template
 * on stderr. Stack traces and command output only show with `--verbose`.
 * The outcome is left in `process.exitCode`.
 */
export async function runWithErrorBoundary(
  main: () => Promise<void>,
  options: BoundaryOptions = {},
): Promise<void> {
  try {
    await main();
  } catch (error) {
    process.exitCode = handleFailure(error, options);
  }
}
