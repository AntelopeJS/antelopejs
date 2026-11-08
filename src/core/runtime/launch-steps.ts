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

/** One step of a launch, working on what the launch carries from step to step. */
export type LaunchStep<Launch> = (launch: Launch) => Promise<void> | void;

function nextEventLoopTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function throwIfStopping(stopping: AbortSignal): void {
  if (stopping.aborted) {
    throw new LaunchInterruptedError();
  }
}

/**
 * Runs one piece of a launch. A failure once the project started shutting
 * down is reported as the interruption it is: the shutdown may already have
 * removed what the work was reading.
 *
 * @throws {LaunchInterruptedError} when the work fails after `stopping` is aborted.
 */
export async function runInterruptibly<Result>(
  work: () => Promise<Result>,
  stopping: AbortSignal,
): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    throwIfStopping(stopping);
    throw error;
  }
}

/**
 * Runs the steps of a launch in order. Before each step, lets the event loop
 * deliver a termination signal that arrived while the previous one kept it
 * busy, then stops the launch if the project is shutting down: loading,
 * constructing or starting more modules would only hold the shutdown back.
 *
 * @throws {LaunchInterruptedError} once `stopping` is aborted.
 */
export async function runLaunchSteps<Launch>(
  steps: readonly LaunchStep<Launch>[],
  launch: Launch,
  stopping: AbortSignal,
): Promise<void> {
  for (const step of steps) {
    await nextEventLoopTurn();
    throwIfStopping(stopping);
    await runInterruptibly(async () => step(launch), stopping);
  }
}
