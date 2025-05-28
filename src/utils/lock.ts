import path from 'path';
import { homedir } from 'os';
import lockfile from 'proper-lockfile';

const LOCK_DIR = path.join(homedir(), '.antelopejs', 'locks');

export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockError';
  }
}

export async function acquireLock(lockName: string, timeoutMs: number = 30000): Promise<() => Promise<void>> {
  const lockFile = path.join(LOCK_DIR, `${lockName}.lock`);

  try {
    // Ensure the lock file exists
    await lockfile.lock(lockFile, {
      retries: {
        retries: Math.floor(timeoutMs / 100),
        factor: 1,
        minTimeout: 100,
        maxTimeout: 100,
      },
      stale: timeoutMs, // Consider locks older than timeout as stale
    });

    // Return a function to release the lock
    return async () => {
      try {
        await lockfile.unlock(lockFile);
      } catch {
        // Ignore errors when unlocking
      }
    };
  } catch {
    throw new LockError(`Failed to acquire lock '${lockName}' after ${timeoutMs}ms`);
  }
}
