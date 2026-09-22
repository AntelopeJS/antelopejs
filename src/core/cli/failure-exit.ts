import { SUCCESS_EXIT_CODE } from "./exit-codes";

export const FORCED_EXIT_GRACE_MS = 2000;

function requestedExitCode(): number {
  return typeof process.exitCode === "number"
    ? process.exitCode
    : SUCCESS_EXIT_CODE;
}

/**
 * Guarantees a run that failed leaves the process, whatever it left running.
 *
 * A boot that fails part way through can leave a handle behind — a socket a
 * module bound before one of its peers threw — and a failing exit code alone
 * never closes it: the command reports the failure, returns, and the process
 * lingers with nothing serving it. Whatever waits on that process, a
 * supervisor or a CI step, waits forever.
 *
 * The forced exit is scheduled on an unref'd timer, so a process with nothing
 * left to do still exits on its own, with the same code, and the grace period
 * leaves room for whatever cleanup is still draining.
 */
export function forceExitOnFailure(
  graceMs: number = FORCED_EXIT_GRACE_MS,
): NodeJS.Timeout | undefined {
  const code = requestedExitCode();
  if (code === SUCCESS_EXIT_CODE) {
    return undefined;
  }

  const timer = setTimeout(() => process.exit(code), graceMs);
  timer.unref();
  return timer;
}
