import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { IFileSystem } from "../../types";
import {
  currentProcess,
  hasErrorCode,
  isLiveProcess,
  isProcessRef,
  type ProcessRef,
} from "./cache-leases";

const LOCK_FOLDER = ".prune.lock";
const OWNER_FILE = "owner.json";
const STALE_AFTER_MS = 60_000;
const POLL_INTERVAL_MS = 25;

/**
 * The state of `<cache>/.prune.lock`. A lock is stale when its owner ran on
 * this machine and is gone, or when it is older than {@link STALE_AFTER_MS}.
 */
type PruneLockState = "free" | "live" | "stale";

/** The prune lock this process holds on a cache folder. */
export interface PruneLock {
  release(): Promise<void>;
}

async function readOwner(
  lockFolder: string,
  fs: IFileSystem,
): Promise<ProcessRef | undefined> {
  try {
    const owner: unknown = JSON.parse(
      await fs.readFileString(path.join(lockFolder, OWNER_FILE)),
    );
    return isProcessRef(owner) ? owner : undefined;
  } catch {
    return undefined;
  }
}

async function readModifiedTime(
  lockFolder: string,
  fs: IFileSystem,
): Promise<number | undefined> {
  if (!(await fs.exists(lockFolder))) {
    return undefined;
  }
  try {
    return (await fs.stat(lockFolder)).mtimeMs;
  } catch (error) {
    if (error instanceof Error && hasErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function readLockState(
  lockFolder: string,
  fs: IFileSystem,
): Promise<PruneLockState> {
  const modified = await readModifiedTime(lockFolder, fs);
  if (modified === undefined) {
    return "free";
  }
  if (Date.now() - modified > STALE_AFTER_MS) {
    return "stale";
  }
  const owner = await readOwner(lockFolder, fs);
  return owner !== undefined && !isLiveProcess(owner) ? "stale" : "live";
}

async function tryCreateLock(
  lockFolder: string,
  fs: IFileSystem,
): Promise<PruneLock | undefined> {
  try {
    await fs.mkdir(lockFolder);
  } catch (error) {
    if (error instanceof Error && hasErrorCode(error, "EEXIST")) {
      return undefined;
    }
    throw error;
  }
  await fs.writeFile(
    path.join(lockFolder, OWNER_FILE),
    JSON.stringify(currentProcess()),
  );
  return {
    release: () => fs.rm(lockFolder, { recursive: true, force: true }),
  };
}

/**
 * Takes the prune lock of the cache at `cachePath`. A stale lock is removed
 * and taking it is tried once more.
 *
 * @returns the lock, or `undefined` when a live prune holds it.
 */
export async function acquirePruneLock(
  cachePath: string,
  fs: IFileSystem,
): Promise<PruneLock | undefined> {
  const lockFolder = path.join(cachePath, LOCK_FOLDER);
  await fs.mkdir(cachePath, { recursive: true });
  const taken = await tryCreateLock(lockFolder, fs);
  if (taken !== undefined) {
    return taken;
  }
  const state = await readLockState(lockFolder, fs);
  if (state === "live") {
    return undefined;
  }
  if (state === "stale") {
    await fs.rm(lockFolder, { recursive: true, force: true });
  }
  return tryCreateLock(lockFolder, fs);
}

/**
 * Resolves once no live prune holds the lock of the cache at `cachePath`. A
 * stale lock is not waited for.
 */
export async function waitWhilePruneLocked(
  cachePath: string,
  fs: IFileSystem,
): Promise<void> {
  const lockFolder = path.join(cachePath, LOCK_FOLDER);
  while ((await readLockState(lockFolder, fs)) === "live") {
    await delay(POLL_INTERVAL_MS);
  }
}
