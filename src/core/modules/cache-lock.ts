import { createHash, randomUUID } from "node:crypto";
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

const OWNER_FILE = "owner.json";
const HEARTBEAT_INTERVAL_MS = 10_000;
const SILENT_AFTER_MS = 60_000;
/**
 * How long a lock folder may go without `owner.json` before a waiter removes
 * it. It equals {@link SILENT_AFTER_MS}, so a live creator that stalls between
 * creating the folder and writing its owner keeps its lock as long as a live
 * holder whose heartbeat stalls does.
 */
const CREATION_WINDOW_MS = SILENT_AFTER_MS;
const POLL_INTERVAL_MS = 25;
const REMOVE_ATTEMPTS = 10;
const DOWNLOADS_FOLDER = ".downloads";
const LOCK_EXTENSION = ".lock";
const MAX_ENCODED_LENGTH = 200;
const KEPT_BY_URI_ENCODING = /[!'()*~]/g;

/** The lock that one prune of a cache at a time holds. */
export const PRUNE_LOCK = ".prune.lock";

/** The lock held around each read, merge and rename of a cache's `manifest.json`. */
export const MANIFEST_LOCK = ".manifest.lock";

/**
 * A lock of a cache, named by its folder relative to the cache: the prune
 * lock, the manifest lock, or the download lock of one cache entry.
 */
export type CacheLockName =
  | typeof PRUNE_LOCK
  | typeof MANIFEST_LOCK
  | `${typeof DOWNLOADS_FOLDER}/${string}${typeof LOCK_EXTENSION}`;

/**
 * The download lock of the cache entry `entry`, such as `@scope/pkg@1.0.0`:
 * `.downloads/<entry>.lock`, with the entry percent-encoded into one file
 * name, or hashed when that name would be too long for a file system.
 */
export function downloadLockOf(entry: string): CacheLockName {
  const encoded = encodeURIComponent(entry).replace(
    KEPT_BY_URI_ENCODING,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const name =
    encoded.length > MAX_ENCODED_LENGTH
      ? createHash("sha256").update(entry).digest("hex")
      : encoded;
  return `${DOWNLOADS_FOLDER}/${name}${LOCK_EXTENSION}`;
}

/**
 * What `<cache>/<lock>/owner.json` holds: the process that holds the lock, a
 * token that names this hold of the lock, and a heartbeat count that the
 * holder raises while it holds the lock.
 */
interface LockOwner extends ProcessRef {
  token: string;
  beat: number;
}

/** A clock that never goes back, in milliseconds, such as `performance.now`. */
type MonotonicClock = () => number;

/** A lock this process holds on a cache. */
export interface CacheLock {
  /**
   * Whether `owner.json` still holds the token of this hold, so that no
   * other process has taken the lock over. A holder checks it before each
   * step that removes or replaces what the lock guards.
   */
  isHeld(): Promise<boolean>;
  /** Stops the heartbeat, and removes the lock unless another process holds it now. */
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

/** The owner `text` holds, or `undefined` when it is not one. */
function parseOwner(text: string): LockOwner | undefined {
  try {
    const owner: unknown = JSON.parse(text);
    return isLockOwner(owner) ? owner : undefined;
  } catch {
    return undefined;
  }
}

async function readOwner(
  lockFolder: string,
  fs: IFileSystem,
): Promise<LockOwner | undefined> {
  try {
    return parseOwner(
      await fs.readFileString(path.join(lockFolder, OWNER_FILE)),
    );
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

/** Whether the owner of the lock at `lockFolder` holds `token`; `undefined` stands for an owner that cannot be read. */
async function holdsToken(
  lockFolder: string,
  token: string | undefined,
  fs: IFileSystem,
): Promise<boolean> {
  return (await readOwner(lockFolder, fs))?.token === token;
}

/**
 * Removes the lock folder at `lockFolder`. On Windows a waiter that reads
 * `owner.json` at that moment keeps the folder from being removed, so a
 * failed removal is tried again after a pause, up to ten times.
 */
async function removeLockFolder(
  lockFolder: string,
  fs: IFileSystem,
): Promise<void> {
  for (let attempt = 1; attempt < REMOVE_ATTEMPTS; attempt += 1) {
    try {
      await fs.rm(lockFolder, { recursive: true, force: true });
      return;
    } catch {
      await delay(POLL_INTERVAL_MS);
    }
  }
  await fs.rm(lockFolder, { recursive: true, force: true });
}

/**
 * Removes the lock at `lockFolder` that this process created and failed to
 * write its owner in, when `owner.json` is missing or holds `token`. An
 * `owner.json` of another hold, or one that cannot be read, as while another
 * process renames it, keeps the folder.
 */
async function removeUnlessOwnedByAnother(
  lockFolder: string,
  token: string,
  fs: IFileSystem,
): Promise<void> {
  let text: string;
  try {
    text = await fs.readFileString(path.join(lockFolder, OWNER_FILE));
  } catch (error) {
    if (error instanceof Error && hasErrorCode(error, "ENOENT")) {
      await removeLockFolder(lockFolder, fs);
    }
    return;
  }
  if (parseOwner(text)?.token === token) {
    await removeLockFolder(lockFolder, fs);
  }
}

/** Removes the lock at `lockFolder` when its owner still holds `token`. */
async function removeIfHeldBy(
  lockFolder: string,
  token: string | undefined,
  fs: IFileSystem,
): Promise<void> {
  if (await holdsToken(lockFolder, token, fs)) {
    await removeLockFolder(lockFolder, fs);
  }
}

/**
 * The time on the clock of the file system that holds `folder`: the date it
 * gives a probe file it creates in `folder`, which is then removed.
 */
async function fileSystemNow(folder: string, fs: IFileSystem): Promise<number> {
  const probe = path.join(folder, `.${randomUUID()}.probe`);
  await fs.writeFile(probe, "");
  try {
    return (await fs.stat(probe)).mtimeMs;
  } finally {
    await fs.rm(probe, { force: true });
  }
}

/**
 * Whether the lock at `lockFolder` has no `owner.json`, and the file system
 * that holds it dates the folder more than {@link CREATION_WINDOW_MS} back,
 * as a lock whose creator stopped between creating the folder and writing
 * its owner. Both dates come from the clock of that file system, so a clock
 * of this machine that disagrees with it does not matter. `owner.json` is
 * looked for again after the folder is dated, so that a lock another process
 * took meanwhile and wrote its owner in is not abandoned. A lock that cannot
 * be dated so, as on a cache this process may not write, is not abandoned.
 */
async function isAbandoned(
  lockFolder: string,
  fs: IFileSystem,
): Promise<boolean> {
  const ownerFile = path.join(lockFolder, OWNER_FILE);
  if (await fs.exists(ownerFile)) {
    return false;
  }
  try {
    const now = await fileSystemNow(path.dirname(lockFolder), fs);
    const created = (await fs.stat(lockFolder)).mtimeMs;
    return now - created > CREATION_WINDOW_MS && !(await fs.exists(ownerFile));
  } catch {
    return false;
  }
}

/** Whether `owner` ran on this machine and pid namespace and has exited. */
function hasExited(owner: LockOwner | undefined): boolean {
  return owner !== undefined && !isLiveProcess(owner);
}

/**
 * Rewrites the owner of the lock every `intervalMs` with its heartbeat raised
 * by one, so that a waiter sees the holder is alive. It stops once the lock
 * holds another token, so that it never writes over the owner of another
 * process. A failed beat is skipped.
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
    pending = pending
      .then(async () => {
        if (!(await holdsToken(lockFolder, owner.token, fs))) {
          clearInterval(timer);
          return;
        }
        beat += 1;
        await writeOwner(lockFolder, { ...owner, beat }, fs);
      })
      .catch(() => undefined);
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    return pending;
  };
}

/**
 * Creates the lock folder `lockFolder` with `owner` in it. The owner is first
 * written to a file beside the folder, which is renamed into the folder once
 * it exists, so that a write the file system refuses, as on a full disk,
 * fails before any lock folder exists. Only that rename can fail once the
 * folder exists, and then the folder is removed unless another hold owns it.
 *
 * @returns whether this process created the folder; `false` when it exists.
 */
async function createLockFolder(
  lockFolder: string,
  owner: LockOwner,
  fs: IFileSystem,
): Promise<boolean> {
  await fs.mkdir(path.dirname(lockFolder), { recursive: true });
  const staged = `${lockFolder}.${OWNER_FILE}.${owner.token}.tmp`;
  try {
    await fs.writeFile(staged, JSON.stringify(owner));
    try {
      await fs.mkdir(lockFolder);
    } catch (error) {
      if (error instanceof Error && hasErrorCode(error, "EEXIST")) {
        return false;
      }
      throw error;
    }
    try {
      await fs.rename(staged, path.join(lockFolder, OWNER_FILE));
    } catch (error) {
      await removeUnlessOwnedByAnother(lockFolder, owner.token, fs);
      throw error;
    }
    return true;
  } finally {
    await fs.rm(staged, { force: true });
  }
}

async function tryCreateLock(
  lockFolder: string,
  fs: IFileSystem,
  heartbeatMs: number,
): Promise<CacheLock | undefined> {
  const owner: LockOwner = {
    ...currentProcess(),
    token: randomUUID(),
    beat: 0,
  };
  if (!(await createLockFolder(lockFolder, owner, fs))) {
    return undefined;
  }
  const stopHeartbeat = startHeartbeat(lockFolder, owner, fs, heartbeatMs);
  return {
    isHeld: () => holdsToken(lockFolder, owner.token, fs),
    release: async () => {
      await stopHeartbeat();
      await removeIfHeldBy(lockFolder, owner.token, fs);
    },
  };
}

/**
 * Takes the lock `name` of the cache at `cachePath` if no live process holds
 * it, and keeps its heartbeat every `heartbeatMs` until it is released. A
 * lock whose owner ran on this machine and pid namespace and has exited is
 * taken over. Any other lock is left alone, whatever its age, since another
 * machine's clock may disagree.
 *
 * @returns the lock, or `undefined` when another process may hold it.
 */
export async function tryAcquireCacheLock(
  cachePath: string,
  name: CacheLockName,
  fs: IFileSystem,
  heartbeatMs = HEARTBEAT_INTERVAL_MS,
): Promise<CacheLock | undefined> {
  const lockFolder = path.join(cachePath, name);
  const taken = await tryCreateLock(lockFolder, fs, heartbeatMs);
  if (taken !== undefined) {
    return taken;
  }
  const owner = await readOwner(lockFolder, fs);
  if (owner === undefined || !hasExited(owner)) {
    return undefined;
  }
  await removeIfHeldBy(lockFolder, owner.token, fs);
  return tryCreateLock(lockFolder, fs, heartbeatMs);
}

function isSameHold(owner: LockOwner | undefined, seen: LockOwner | undefined) {
  return owner?.token === seen?.token && owner?.beat === seen?.beat;
}

/**
 * Resolves once no live process holds the lock `name` of the cache at
 * `cachePath`: the lock is gone, or its owner ran on this machine and pid
 * namespace and has exited, or it has no `owner.json` and its file system
 * dates it past the creation window, or its owner has not changed for 60 s on
 * `now`, the clock of this process, so that machines whose clocks disagree
 * still agree. A lock without `owner.json` past the creation window is
 * removed. An owner that cannot be read counts as unchanged. A lock silent for
 * 60 s is removed when it still holds the token last seen.
 */
export async function waitWhileCacheLocked(
  cachePath: string,
  name: CacheLockName,
  fs: IFileSystem,
  now: MonotonicClock = () => performance.now(),
): Promise<void> {
  const lockFolder = path.join(cachePath, name);
  let seen: LockOwner | undefined;
  let changedAt = now();
  while (await fs.exists(lockFolder)) {
    const owner = await readOwner(lockFolder, fs);
    if (hasExited(owner)) {
      return;
    }
    if (owner === undefined && (await isAbandoned(lockFolder, fs))) {
      await removeLockFolder(lockFolder, fs);
      return;
    }
    if (owner !== undefined && !isSameHold(owner, seen)) {
      seen = owner;
      changedAt = now();
    } else if (now() - changedAt >= SILENT_AFTER_MS) {
      await removeIfHeldBy(lockFolder, seen?.token, fs);
      return;
    }
    await delay(POLL_INTERVAL_MS);
  }
}

/**
 * Takes the lock `name` of the cache at `cachePath`, waiting while another
 * live process holds it, as {@link waitWhileCacheLocked} decides.
 */
export async function acquireCacheLock(
  cachePath: string,
  name: CacheLockName,
  fs: IFileSystem,
  now: MonotonicClock = () => performance.now(),
): Promise<CacheLock> {
  let lock = await tryAcquireCacheLock(cachePath, name, fs);
  while (lock === undefined) {
    await waitWhileCacheLocked(cachePath, name, fs, now);
    lock = await tryAcquireCacheLock(cachePath, name, fs);
  }
  return lock;
}
