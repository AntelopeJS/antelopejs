import path from 'path';
import { homedir } from 'os';
import lockfile from 'proper-lockfile';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

export class AsyncLock {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    await this.wait();

    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private wait(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

function getLockDir(): string {
  return path.join(homedir(), '.antelopejs', 'locks');
}

export async function acquireLock(lockName: string, timeoutMs: number = 30000): Promise<() => Promise<void>> {
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
      // ignore
    }
  };
}
