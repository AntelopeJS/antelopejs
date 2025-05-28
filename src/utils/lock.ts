import path from 'path';
import { homedir } from 'os';
import lockfile from 'proper-lockfile';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
const LOCK_DIR = path.join(homedir(), '.antelopejs', 'locks');

export async function acquireLock(lockName: string, timeoutMs: number = 30000): Promise<() => Promise<void>> {
  const sanitizedLockName = lockName.replace(/[^a-zA-Z0-9_]/g, '_');
  const lockFile = path.join(LOCK_DIR, `${sanitizedLockName}.lock`);

  // Ensure the lock file exists
  if (!existsSync(lockFile)) {
    mkdirSync(LOCK_DIR, { recursive: true });
    writeFileSync(lockFile, '');
  }

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
}
