import { isPromptCancellation, reportCancellation } from "../cancellation";
import {
  CANCELLED_EXIT_CODE,
  SUCCESS_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../exit-codes";
import type { FailureTranslator, Ui } from "./types";

export interface BoundaryOptions {
  ui?: Ui;
  verbose?: boolean;
  /**
   * Explains failures the commands did not throw as a `CliError`, before the
   * built-in translations of missing paths, npm and git failures.
   */
  translate?: FailureTranslator;
}

interface CommanderExit {
  code: string;
  exitCode: number;
}

interface FailureHandler {
  matches(error: unknown): boolean;
  handle(error: unknown): number;
}

const COMMANDER_CODE_PREFIX = "commander.";

function reportCancelledRun(): number {
  reportCancellation();
  return CANCELLED_EXIT_CODE;
}

/**
 * Recognizes the errors of any copy of commander by their `commander.*`
 * code, so a plugin that bundles its own commander is handled the same way.
 */
function isCommanderExit(error: unknown): error is CommanderExit {
  if (!(error instanceof Error)) {
    return false;
  }
  const { code, exitCode } = error as Partial<CommanderExit>;
  return (
    typeof code === "string" &&
    code.startsWith(COMMANDER_CODE_PREFIX) &&
    typeof exitCode === "number"
  );
}

function commanderExitCode(error: unknown): number {
  return (error as CommanderExit).exitCode === SUCCESS_EXIT_CODE
    ? SUCCESS_EXIT_CODE
    : USAGE_EXIT_CODE;
}

const FAILURE_HANDLERS: FailureHandler[] = [
  { matches: isPromptCancellation, handle: reportCancelledRun },
  { matches: isCommanderExit, handle: commanderExitCode },
];

async function handleFailure(
  error: unknown,
  options: BoundaryOptions,
): Promise<number> {
  const handler = FAILURE_HANDLERS.find((candidate) =>
    candidate.matches(error),
  );
  if (handler) {
    return handler.handle(error);
  }
  const { reportFailure } = await import("./failures");
  return reportFailure(error, options.ui, options.verbose, options.translate);
}

/**
 * Runs the CLI and reports whatever it throws exactly once: a cancelled
 * prompt as `Cancelled` (exit 130), commander's help and version exits with
 * their own code, and every other failure with the what / why / fix template
 * on stderr. Stack traces and command output only show with `--verbose`.
 * The outcome is left in `process.exitCode`. The failure descriptions are
 * only loaded when something fails, so a successful run stays light.
 */
export async function runWithErrorBoundary(
  main: () => Promise<void>,
  options: BoundaryOptions = {},
): Promise<void> {
  try {
    await main();
  } catch (error) {
    process.exitCode = await handleFailure(error, options);
  }
}
