import type { ShutdownManager } from "../shutdown";

const LAUNCH_INTERRUPTED_ERROR_NAME = "LaunchInterruptedError";
const LAUNCH_INTERRUPTED_MESSAGE =
  "The project started shutting down before its launch completed";

/** Thrown by a launch that stops because the project is shutting down. */
export class LaunchInterruptedError extends Error {
  constructor() {
    super(LAUNCH_INTERRUPTED_MESSAGE);
    this.name = LAUNCH_INTERRUPTED_ERROR_NAME;
  }
}

function nextEventLoopTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Called between the steps of a launch. Lets the event loop deliver a
 * termination signal that arrived while the previous step kept it busy, then
 * stops the launch if the project is shutting down: loading, constructing or
 * starting more modules would only hold the shutdown back.
 */
export async function continueUnlessShuttingDown(
  shutdownManager: ShutdownManager,
): Promise<void> {
  await nextEventLoopTurn();
  if (shutdownManager.active) {
    throw new LaunchInterruptedError();
  }
}
