import { linkSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";

import { alive } from "./lifecycle.mts";

const LOCK_WAIT_MS = 300_000;
const LOCK_POLL_MS = 250;

/** How long `withLock` waits for a live holder and how often it looks again. */
export interface LockOptions {
  waitMs?: number;
  pollMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function codeOf(failure: Error): string | undefined {
  return "code" in failure ? String(failure.code) : undefined;
}

function ownerOf(file: string): number | undefined {
  try {
    const pid = Number(readFileSync(file, "utf8"));
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Creates the lock with its owner already written, so no process ever reads an empty lock. */
function tryAcquire(lock: string): boolean {
  const pending = `${lock}.${process.pid}.pending`;
  writeFileSync(pending, String(process.pid));
  try {
    linkSync(pending, lock);
    return true;
  } catch (failure) {
    if (failure instanceof Error && codeOf(failure) === "EEXIST") {
      return false;
    }
    throw failure;
  } finally {
    rmSync(pending, { force: true });
  }
}

/**
 * Removes the lock only if it still belongs to `seen` and that process is gone. Returns whether it removed it.
 *
 * A waiter first links the lock's file under a claim name for `seen`, which only one waiter can do at a time,
 * then reads the owner from that link. Only the dead owner or the claim holder can remove that file, so a lock
 * another process took after the waiter looked is never removed.
 */
export function reclaimLock(lock: string, seen: number): boolean {
  const claim = `${lock}.reclaim-${seen}`;
  try {
    linkSync(lock, claim);
  } catch (failure) {
    if (failure instanceof Error && (codeOf(failure) === "ENOENT" || codeOf(failure) === "EEXIST")) {
      return false;
    }
    throw failure;
  }
  try {
    if (ownerOf(claim) !== seen || alive(seen)) {
      return false;
    }
    unlinkSync(lock);
    return true;
  } finally {
    rmSync(claim, { force: true });
  }
}

/**
 * Runs `work` while holding a lock file that names the process by PID. At most one process holds it at a time.
 * A lock whose owner is gone, for example after Ctrl-C, is reclaimed by `reclaimLock`. A live holder is waited
 * for until `waitMs` passes.
 */
export async function withLock(lock: string, work: () => Promise<void>, options: LockOptions = {}): Promise<void> {
  const deadline = Date.now() + (options.waitMs ?? LOCK_WAIT_MS);
  while (!tryAcquire(lock)) {
    const owner = ownerOf(lock);
    if (owner !== undefined && !alive(owner) && reclaimLock(lock, owner)) {
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`Another process held ${lock} for ${options.waitMs ?? LOCK_WAIT_MS} ms: remove ${lock}* if no verify-ajs journey is running.`);
    }
    await sleep(options.pollMs ?? LOCK_POLL_MS);
  }
  try {
    await work();
  } finally {
    rmSync(lock, { force: true });
  }
}
