import { expect } from "chai";
import {
  existsSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { NodeFileSystem } from "../../src/core/filesystem";
import { type CacheKeep, ModuleCache } from "../../src/core/modules";
import {
  acquirePruneLock,
  waitWhilePruneLocked,
} from "../../src/core/modules/cache-prune-lock";
import {
  deadPid,
  holdPruneLock,
  manifestKeys,
  otherNamespace,
  pruneLockPath,
  readLeases,
  readLockBeat,
  seedCache,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir } from "../helpers/temp";

const KEEP_NOTHING: CacheKeep = () => false;
const PENDING_WINDOW_MS = 200;
const SETTLE_WINDOW_MS = 2000;
const SILENT_LOCK_MS = 60_000;
const SKEWED_BY_MS = 120_000;
const fs = new NodeFileSystem();

function prune(cachePath: string) {
  return new ModuleCache(cachePath).prune(async () => KEEP_NOTHING);
}

function settlesWithin(promise: Promise<unknown>, ms: number) {
  const timeout = new Promise<false>((resolve) =>
    setTimeout(() => resolve(false), ms).unref(),
  );
  return Promise.race([promise.then(() => true), timeout]);
}

/** Dates the prune lock of `cachePath` two minutes back, as a machine whose clock runs behind would. */
function skewLockClock(cachePath: string): void {
  const past = new Date(Date.now() - SKEWED_BY_MS);
  utimesSync(pruneLockPath(cachePath), past, past);
}

/** A monotonic clock that moves only when the test sets `at`. */
function fakeClock() {
  const clock = { at: 0, now: () => clock.at };
  return clock;
}

const OTHER_MACHINE = () => ({
  host: `${os.hostname()}-elsewhere`,
  pid: deadPid(),
});

describe("ModuleCache prune lock", () => {
  let root: string;
  let cachePath: string;

  beforeEach(() => {
    root = makeTempDir("ajs-cache-prune-lock-");
    cachePath = path.join(root, "cache");
    seedCache(cachePath, ["a@1.0.0", "b@1.0.0"]);
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  for (const { label, hold } of [
    {
      label: "a prune that has not yet written its owner",
      hold: (cache: string) => mkdirSync(pruneLockPath(cache)),
    },
    {
      label: "another live prune",
      hold: (cache: string) => holdPruneLock(cache, { pid: process.pid }),
    },
    {
      label: "another live prune whose lock a clock two minutes behind dated",
      hold: (cache: string) => {
        holdPruneLock(cache, { pid: process.pid });
        skewLockClock(cache);
      },
    },
    {
      label: "a prune of this hostname in another pid namespace",
      hold: (cache: string) =>
        holdPruneLock(cache, { namespace: otherNamespace(), pid: deadPid() }),
    },
    {
      label: "a prune of another machine",
      hold: (cache: string) => holdPruneLock(cache, OTHER_MACHINE()),
    },
  ]) {
    it(`skips while ${label} holds the lock`, async () => {
      hold(cachePath);

      await prune(cachePath);

      expect(manifestKeys(cachePath)).to.have.length(2);
      expect(existsSync(pruneLockPath(cachePath))).to.equal(true);
    });
  }

  it("takes over the lock of a prune on this machine that has exited", async () => {
    holdPruneLock(cachePath, { pid: deadPid() });

    await prune(cachePath);

    expect(manifestKeys(cachePath)).to.deep.equal([]);
    expect(existsSync(pruneLockPath(cachePath))).to.equal(false);
  });

  it("raises the heartbeat in its owner while it holds the lock, and removes the lock on release", async () => {
    const lock = await acquirePruneLock(cachePath, fs, 10);
    expect(lock).to.not.equal(undefined);
    const first = readLockBeat(cachePath) ?? 0;

    let beat = first;
    for (let tries = 0; beat <= first && tries < 100; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      beat = readLockBeat(cachePath) ?? first;
    }
    await lock?.release();

    expect(beat).to.be.greaterThan(first);
    expect(existsSync(pruneLockPath(cachePath))).to.equal(false);
  });
});

describe("A run claiming a cache folder while a prune holds the lock", () => {
  let root: string;
  let cachePath: string;

  beforeEach(() => {
    root = makeTempDir("ajs-cache-lock-wait-");
    cachePath = path.join(root, "cache");
    mkdirSync(cachePath);
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("waits while a live prune holds the cache, then returns once it is released", async () => {
    holdPruneLock(cachePath, { pid: process.pid });
    const claimed = new ModuleCache(cachePath).getFolder("a@1.0.0", true, true);

    expect(await settlesWithin(claimed, PENDING_WINDOW_MS)).to.equal(false);
    expect(readLeases(cachePath)).to.have.length(1);

    rmSync(pruneLockPath(cachePath), { recursive: true });
    expect(await settlesWithin(claimed, SETTLE_WINDOW_MS)).to.equal(true);
  });

  it("does not wait for a prune lock whose owner on this machine has exited", async () => {
    holdPruneLock(cachePath, { pid: deadPid() });

    const claimed = new ModuleCache(cachePath).getFolder("a@1.0.0", true, true);

    expect(await settlesWithin(claimed, SETTLE_WINDOW_MS)).to.equal(true);
  });

  it("waits for a silent lock of another machine, whatever its date, until 60 s pass on its own clock, then removes it", async () => {
    holdPruneLock(cachePath, OTHER_MACHINE());
    skewLockClock(cachePath);
    const clock = fakeClock();

    const waiting = waitWhilePruneLocked(cachePath, fs, clock.now);

    expect(await settlesWithin(waiting, PENDING_WINDOW_MS)).to.equal(false);
    clock.at = SILENT_LOCK_MS - 1;
    expect(await settlesWithin(waiting, PENDING_WINDOW_MS)).to.equal(false);
    clock.at = SILENT_LOCK_MS;
    expect(await settlesWithin(waiting, SETTLE_WINDOW_MS)).to.equal(true);
    expect(existsSync(pruneLockPath(cachePath))).to.equal(false);
  });

  for (const { label, change } of [
    { label: "its heartbeat rises", change: { beat: 1 } },
    { label: "another prune takes the lock", change: { token: "next-prune" } },
  ]) {
    it(`counts the 60 s from the last change of the owner, as when ${label}`, async () => {
      holdPruneLock(cachePath, OTHER_MACHINE());
      const clock = fakeClock();
      const waiting = waitWhilePruneLocked(cachePath, fs, clock.now);
      expect(await settlesWithin(waiting, PENDING_WINDOW_MS)).to.equal(false);

      clock.at = 50_000;
      holdPruneLock(cachePath, { ...OTHER_MACHINE(), ...change });
      expect(await settlesWithin(waiting, PENDING_WINDOW_MS)).to.equal(false);
      clock.at = 50_000 + SILENT_LOCK_MS - 1;
      expect(await settlesWithin(waiting, PENDING_WINDOW_MS)).to.equal(false);

      clock.at = 50_000 + SILENT_LOCK_MS;
      expect(await settlesWithin(waiting, SETTLE_WINDOW_MS)).to.equal(true);
    });
  }

  it("removes a lock that shows no owner for 60 s, as one a prune left when it crashed", async () => {
    mkdirSync(pruneLockPath(cachePath));
    const clock = fakeClock();

    const waiting = waitWhilePruneLocked(cachePath, fs, clock.now);
    expect(await settlesWithin(waiting, PENDING_WINDOW_MS)).to.equal(false);
    clock.at = SILENT_LOCK_MS;

    expect(await settlesWithin(waiting, SETTLE_WINDOW_MS)).to.equal(true);
    expect(existsSync(pruneLockPath(cachePath))).to.equal(false);
  });

  it("stops waiting, but keeps the lock, when its owner turns unreadable and stays so for 60 s", async () => {
    holdPruneLock(cachePath, OTHER_MACHINE());
    const clock = fakeClock();
    const waiting = waitWhilePruneLocked(cachePath, fs, clock.now);
    expect(await settlesWithin(waiting, PENDING_WINDOW_MS)).to.equal(false);

    writeFileSync(path.join(pruneLockPath(cachePath), "owner.json"), "{");
    clock.at = SILENT_LOCK_MS;

    expect(await settlesWithin(waiting, SETTLE_WINDOW_MS)).to.equal(true);
    expect(existsSync(pruneLockPath(cachePath))).to.equal(true);
  });
});
