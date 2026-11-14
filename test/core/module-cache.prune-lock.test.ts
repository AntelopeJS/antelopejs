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
import {
  type CacheKeep,
  ModuleCache,
  PRUNE_LOCK,
  tryAcquireCacheLock,
  waitWhileCacheLocked,
} from "../../src/core/modules";
import {
  cacheFolderNames,
  deadPid,
  holdPruneLock,
  manifestKeys,
  otherNamespace,
  pruneLockPath,
  readLeases,
  readLockOwner,
  RefusingFileSystem,
  seedCache,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir } from "../helpers/temp";

const KEEP_NOTHING: CacheKeep = () => false;
const PENDING_WINDOW_MS = 200;
const SETTLE_WINDOW_MS = 2000;
const SILENT_LOCK_MS = 60_000;
const PAST_CREATION_WINDOW_MS = 61_000;
const STALLED_CREATOR_MS = 30_000;
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

/** Dates the prune lock folder of `cachePath` `ms` back. */
function datePruneLockBack(cachePath: string, ms: number): void {
  const past = new Date(Date.now() - ms);
  utimesSync(pruneLockPath(cachePath), past, past);
}

/** Dates the prune lock of `cachePath` two minutes back, as a machine whose clock runs behind would. */
function skewLockClock(cachePath: string): void {
  datePruneLockBack(cachePath, SKEWED_BY_MS);
}

/** The heartbeat count in the owner of the prune lock of `cachePath`, if it can be read. */
function readLockBeat(cachePath: string): number | undefined {
  return readLockOwner(pruneLockPath(cachePath))?.beat;
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

/**
 * The real file system, except that the first `failures` removals of
 * `folder` fail with `ENOTEMPTY`, as on Windows while another process reads
 * a file in it.
 */
class BusyFolderFileSystem extends NodeFileSystem {
  constructor(
    private readonly folder: string,
    private failures: number,
  ) {
    super();
  }

  override rm(
    file: string,
    options?: { recursive?: boolean; force?: boolean },
  ) {
    if (file === this.folder && this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(
        Object.assign(new Error("ENOTEMPTY: directory not empty"), {
          code: "ENOTEMPTY",
        }),
      );
    }
    return super.rm(file, options);
  }
}

/**
 * The real file system, except that it dates every file `lagMs` earlier than
 * this machine's clock, as a shared file system whose clock runs behind.
 */
class LaggingClockFileSystem extends NodeFileSystem {
  constructor(private readonly lagMs: number) {
    super();
  }

  override async stat(file: string) {
    const stats = await super.stat(file);
    stats.mtimeMs -= this.lagMs;
    return stats;
  }
}

/**
 * The real file system, except that once `folder` has been dated,
 * `meanwhile` runs, as another process would between that date and what comes next.
 */
class AfterDatingFileSystem extends NodeFileSystem {
  constructor(
    private readonly folder: string,
    private readonly meanwhile: () => void,
  ) {
    super();
  }

  override async stat(file: string) {
    const stats = await super.stat(file);
    if (file === this.folder) {
      this.meanwhile();
    }
    return stats;
  }
}

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
    const lock = await tryAcquireCacheLock(cachePath, PRUNE_LOCK, fs, 10);
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

  it("removes its lock on release though the first removals fail, as on Windows while a waiter reads its owner", async () => {
    const lockFolder = pruneLockPath(cachePath);
    const busy = new BusyFolderFileSystem(lockFolder, 2);

    const lock = await tryAcquireCacheLock(cachePath, PRUNE_LOCK, busy);
    await lock?.release();

    expect(lock).to.not.equal(undefined);
    expect(existsSync(lockFolder)).to.equal(false);
  });

  it("stops beating, and leaves the lock on release, once another process holds it", async () => {
    const lock = await tryAcquireCacheLock(cachePath, PRUNE_LOCK, fs, 10);
    holdPruneLock(cachePath, { pid: process.pid, token: "taken-over" });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const held = await lock?.isHeld();
    await lock?.release();

    expect(held).to.equal(false);
    expect(readLockOwner(pruneLockPath(cachePath))).to.deep.equal({
      token: "taken-over",
      beat: 0,
    });
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

  it("does not wait for a prune lock without owner that its file system dates past the creation window", async () => {
    mkdirSync(pruneLockPath(cachePath));
    datePruneLockBack(cachePath, PAST_CREATION_WINDOW_MS);

    const claimed = new ModuleCache(cachePath).getFolder("a@1.0.0", true, true);

    expect(await settlesWithin(claimed, SETTLE_WINDOW_MS)).to.equal(true);
    expect(existsSync(pruneLockPath(cachePath))).to.equal(false);
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

    const waiting = waitWhileCacheLocked(cachePath, PRUNE_LOCK, fs, clock.now);

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
      const waiting = waitWhileCacheLocked(
        cachePath,
        PRUNE_LOCK,
        fs,
        clock.now,
      );
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

  it("stops waiting, but keeps the lock, when its owner turns unreadable and stays so for 60 s", async () => {
    holdPruneLock(cachePath, OTHER_MACHINE());
    const clock = fakeClock();
    const waiting = waitWhileCacheLocked(cachePath, PRUNE_LOCK, fs, clock.now);
    expect(await settlesWithin(waiting, PENDING_WINDOW_MS)).to.equal(false);

    writeFileSync(path.join(pruneLockPath(cachePath), "owner.json"), "{");
    clock.at = SILENT_LOCK_MS;

    expect(await settlesWithin(waiting, SETTLE_WINDOW_MS)).to.equal(true);
    expect(existsSync(pruneLockPath(cachePath))).to.equal(true);
  });
});

describe("A waiter on a lock without owner", () => {
  let root: string;
  let cachePath: string;

  beforeEach(() => {
    root = makeTempDir("ajs-cache-lock-ownerless-");
    cachePath = path.join(root, "cache");
    mkdirSync(cachePath);
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  for (const { label, age, files } of [
    { label: "just created", age: 0, files: fs },
    {
      label: "whose creator stalls 30 s before writing its owner",
      age: STALLED_CREATOR_MS,
      files: fs,
    },
    {
      label:
        "just created on a file system whose clock runs two minutes behind",
      age: 0,
      files: new LaggingClockFileSystem(SKEWED_BY_MS),
    },
  ]) {
    it(`waits for a lock without owner ${label}, and removes it once it shows no owner for 60 s`, async () => {
      mkdirSync(pruneLockPath(cachePath));
      datePruneLockBack(cachePath, age);
      const clock = fakeClock();

      const waiting = waitWhileCacheLocked(
        cachePath,
        PRUNE_LOCK,
        files,
        clock.now,
      );
      expect(await settlesWithin(waiting, PENDING_WINDOW_MS)).to.equal(false);
      clock.at = SILENT_LOCK_MS;

      expect(await settlesWithin(waiting, SETTLE_WINDOW_MS)).to.equal(true);
      expect(existsSync(pruneLockPath(cachePath))).to.equal(false);
    });
  }

  it("keeps the lock another prune takes while it dates an old lock without owner", async () => {
    const lockFolder = pruneLockPath(cachePath);
    mkdirSync(lockFolder);
    datePruneLockBack(cachePath, PAST_CREATION_WINDOW_MS);
    const takenMeanwhile = new AfterDatingFileSystem(lockFolder, () => {
      rmSync(lockFolder, { recursive: true });
      holdPruneLock(cachePath, { pid: process.pid, token: "next-prune" });
    });

    const waiting = waitWhileCacheLocked(
      cachePath,
      PRUNE_LOCK,
      takenMeanwhile,
      fakeClock().now,
    );

    expect(await settlesWithin(waiting, PENDING_WINDOW_MS)).to.equal(false);
    expect(readLockOwner(lockFolder)?.token).to.equal("next-prune");
    rmSync(lockFolder, { recursive: true });
    await waiting;
  });

  it("removes at once a lock without owner past the creation window on a file system whose clock runs two minutes ahead", async () => {
    mkdirSync(pruneLockPath(cachePath));
    datePruneLockBack(cachePath, PAST_CREATION_WINDOW_MS);
    const clock = fakeClock();

    const waiting = waitWhileCacheLocked(
      cachePath,
      PRUNE_LOCK,
      new LaggingClockFileSystem(-SKEWED_BY_MS),
      clock.now,
    );

    expect(await settlesWithin(waiting, SETTLE_WINDOW_MS)).to.equal(true);
    expect(existsSync(pruneLockPath(cachePath))).to.equal(false);
  });

  it("removes at once, and leaves nothing beside it, a lock without owner that its file system dates past the creation window, as one a prune left when it crashed before writing its owner", async () => {
    const before = cacheFolderNames(cachePath, ".");
    mkdirSync(pruneLockPath(cachePath));
    datePruneLockBack(cachePath, PAST_CREATION_WINDOW_MS);
    const clock = fakeClock();

    const waiting = waitWhileCacheLocked(cachePath, PRUNE_LOCK, fs, clock.now);

    expect(await settlesWithin(waiting, SETTLE_WINDOW_MS)).to.equal(true);
    expect(cacheFolderNames(cachePath, ".")).to.deep.equal(before);
  });

  it("waits the 60 s for an old lock without owner when it cannot write the probe that reads the file system's clock", async () => {
    mkdirSync(pruneLockPath(cachePath));
    datePruneLockBack(cachePath, PAST_CREATION_WINDOW_MS);
    const clock = fakeClock();
    const readOnly = new RefusingFileSystem((file) => file !== cachePath);

    const waiting = waitWhileCacheLocked(
      cachePath,
      PRUNE_LOCK,
      readOnly,
      clock.now,
    );
    expect(await settlesWithin(waiting, PENDING_WINDOW_MS)).to.equal(false);
    clock.at = SILENT_LOCK_MS;

    expect(await settlesWithin(waiting, SETTLE_WINDOW_MS)).to.equal(true);
  });
});
