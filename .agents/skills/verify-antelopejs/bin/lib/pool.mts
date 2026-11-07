import { availableParallelism } from "node:os";

/** The most features one `journeys` command runs at once, whatever the host offers. */
export const MAX_JOBS = 8;

/**
 * How many features run at once when `--jobs` is not given: a quarter of the
 * cores, between 2 and `MAX_JOBS`. A shared host runs several agents, each of
 * which drives pnpm and a Node.js process per journey, so a quarter leaves
 * the others their share; 16 cores give 4.
 */
export function defaultJobs(cores = availableParallelism()): number {
  return Math.min(MAX_JOBS, Math.max(2, Math.floor(cores / 4)));
}

/**
 * Starts every task, at most `limit` at a time, in the order given. The
 * promises come back in that order, so a caller can report them in it while
 * later tasks are still running.
 */
export function runLimited<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T>[] {
  let running = 0;
  const waiting: (() => void)[] = [];
  const release = (): void => {
    running -= 1;
    waiting.shift()?.();
  };
  const acquire = async (): Promise<void> => {
    while (running >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    running += 1;
  };
  return tasks.map(async (task) => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  });
}
