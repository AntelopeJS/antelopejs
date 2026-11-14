import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import type { IFileSystem } from "../../types";
import { isNumber, isObject, isString } from "../../utils";
import {
  currentProcess,
  hasErrorCode,
  isLiveProcess,
  isProcessRef,
  type ProcessRef,
} from "./cache-leases";

const LOCK_FOLDER = ".prune.lock";
const OWNER_FILE = "owner.json";
const HEARTBEAT_INTERVAL_MS = 10_000;
const SILENT_AFTER_MS = 60_000;
const POLL_INTERVAL_MS = 25;

/**
 * What `<cache>/.prune.lock/owner.json` holds: the pruning process, a token
 * that names this hold of the lock, and a heartbeat count that the pruner
 * raises while it holds the lock.
 */
interface LockOwner extends ProcessRef {
  token: string;
  beat: number;
}

/** A clock that never goes back, in milliseconds, such as `performance.now`. */
type MonotonicClock = () => number;

/** The prune lock this process holds on a cache folder. */
export interface PruneLock {
  release(): Promise<void>;
}

function isLockOwner(value: unknown): value is LockOwner {
  return (
    isProcessRef(value) &&
    isObject(value) &&
    isString(value.token) &&
    isNumber(value.beat)
  );
}

async function readOwner(
  lockFolder: string,
  fs: IFileSystem,
): Promise<LockOwner | undefined> {
  try {
    const owner: unknown = JSON.parse(
      await fs.readFileString(path.join(lockFolder, OWNER_FILE)),
    );
    return isLockOwner(owner) ? owner : undefined;
  } catch {
    return undefined;
  }
}

async function writeOwner(
  lockFolder: string,
  owner: LockOwner,
  fs: IFileSystem,
): Promise<void> {
  const file = path.join(lockFolder, OWNER_FILE);
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(owner));
  await fs.rename(temp, file);
}

/** Whether `owner` ran on this machine and pid namespace and has exited. */
function hasExited(owner: LockOwner | undefined): boolean {
  return owner !== undefined && !isLiveProcess(owner);
}

/**
 * Rewrites the owner of the lock every `intervalMs` with its heartbeat raised
 * by one, so that a waiter sees the prune is alive. A failed beat is skipped.
 *
 * @returns a function that stops the heartbeat once its last write is done.
 */
function startHeartbeat(
  lockFolder: string,
  owner: LockOwner,
  fs: IFileSystem,
  intervalMs: number,
): () => Promise<void> {
  let beat = owner.beat;
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    beat += 1;
    const next: LockOwner = { ...owner, beat };
    pending = pending
      .then(() => writeOwner(lockFolder, next, fs))
      .catch(() => undefined);
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    return pending;
  };
}

async function tryCreateLock(
  lockFolder: string,
  fs: IFileSystem,
  heartbeatMs: number,
): Promise<PruneLock | undefined> {
  try {
    await fs.mkdir(lockFolder);
  } catch (error) {
    if (error instanceof Error && hasErrorCode(error, "EEXIST")) {
      return undefined;
    }
    throw error;
  }
  const owner: LockOwner = {
    ...currentProcess(),
    token: randomUUID(),
    beat: 0,
  };
  try {
    await writeOwner(lockFolder, owner, fs);
  } catch (error) {
    await fs.rm(lockFolder, { recursive: true, force: true });
    throw error;
  }
  const stopHeartbeat = startHeartbeat(lockFolder, owner, fs, heartbeatMs);
  return {
    release: async () => {
      await stopHeartbeat();
      await fs.rm(lockFolder, { recursive: true, force: true });
    },
  };
}

/**
 * Takes the prune lock of the cache at `cachePath`, and keeps its heartbeat
 * every `heartbeatMs` until it is released. A lock whose owner ran on this
 * machine and pid namespace and has exited is taken over. Any other lock is
 * left alone, whatever its age, since another machine's clock may disagree.
 *
 * @returns the lock, or `undefined` when another prune may hold it.
 */
export async function acquirePruneLock(
  cachePath: string,
  fs: IFileSystem,
  heartbeatMs = HEARTBEAT_INTERVAL_MS,
): Promise<PruneLock | undefined> {
  const lockFolder = path.join(cachePath, LOCK_FOLDER);
  await fs.mkdir(cachePath, { recursive: true });
  const taken = await tryCreateLock(lockFolder, fs, heartbeatMs);
  if (taken !== undefined) {
    return taken;
  }
  if (!hasExited(await readOwner(lockFolder, fs))) {
    return undefined;
  }
  await fs.rm(lockFolder, { recursive: true, force: true });
  return tryCreateLock(lockFolder, fs, heartbeatMs);
}

function isSameHold(owner: LockOwner | undefined, seen: LockOwner | undefined) {
  return owner?.token === seen?.token && owner?.beat === seen?.beat;
}

/**
 * Resolves once no live prune holds the lock of the cache at `cachePath`:
 * the lock is gone, or its owner ran on this machine and pid namespace and
 * has exited, or its owner has not changed for 60 s on `now`, the clock of
 * this process, so that machines whose clocks disagree still agree. An owner
 * that cannot be read counts as unchanged. A lock silent for 60 s is removed
 * when it still holds the token last seen.
 */
export async function waitWhilePruneLocked(
  cachePath: string,
  fs: IFileSystem,
  now: MonotonicClock = () => performance.now(),
): Promise<void> {
  const lockFolder = path.join(cachePath, LOCK_FOLDER);
  let seen: LockOwner | undefined;
  let changedAt = now();
  while (await fs.exists(lockFolder)) {
    const owner = await readOwner(lockFolder, fs);
    if (hasExited(owner)) {
      return;
    }
    if (owner !== undefined && !isSameHold(owner, seen)) {
      seen = owner;
      changedAt = now();
    } else if (now() - changedAt >= SILENT_AFTER_MS) {
      if (owner?.token === seen?.token) {
        await fs.rm(lockFolder, { recursive: true, force: true });
      }
      return;
    }
    await delay(POLL_INTERVAL_MS);
  }
}
