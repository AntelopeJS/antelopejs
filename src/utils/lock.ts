import path from 'path';
import { homedir } from 'os';
import lockfile from 'proper-lockfile';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const DEFAULT_LOCK_TIMEOUT_MS = 30000;

function getLockDir(): string {
  return path.join(homedir(), '.antelopejs', 'locks');
}

export async function acquireLock(
  lockName: string,
  timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS,
): Promise<() => Promise<void>> {
  const sanitizedLockName = lockName.replace(/[^a-zA-Z0-9_]/g, '_');
  const lockDir = getLockDir();
  const lockFile = path.join(lockDir, `${sanitizedLockName}.lock`);

  if (!existsSync(lockFile)) {
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(lockFile, '');
  }

  await lockfile.lock(lockFile, {
    retries: {
      retries: Math.floor(timeoutMs / 100),
      factor: 1,
      minTimeout: 100,
      maxTimeout: 100,
    },
    stale: timeoutMs,
  });

  return async () => {
    try {
      await lockfile.unlock(lockFile);
    } catch {
      return;
    }
  };
}
