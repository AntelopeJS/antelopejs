import { expect } from "chai";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NodeFileSystem } from "../../src/core/filesystem";
import { type CacheKeep, ModuleCache } from "../../src/core/modules";
import {
  deadPid,
  FailingOwnerFileSystem,
  hasEntryFolder,
  holdPruneLock,
  leaseNameOf,
  leaseNames,
  manifestKeys,
  otherNamespace,
  pruneLockPath,
  readLockOwner,
  RefusingFileSystem,
  seedCache,
  startIdleProcess,
  thisProcess,
  writeLease,
  writeLeaseText,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir, writeJson } from "../helpers/temp";

const KEEP_NOTHING: CacheKeep = () => false;

function prune(cachePath: string) {
  return new ModuleCache(cachePath).prune(async () => KEEP_NOTHING);
}

/**
 * Fails to write the owner of the prune lock of `cachePath`, as
 * {@link FailingOwnerFileSystem} does, after `takeOver` ran, as another live
 * prune that took the lock folder over would.
 */
class TakenOverOwnerFileSystem extends FailingOwnerFileSystem {
  constructor(private readonly takeOver: () => void) {
    super();
  }

  override writeFile(file: string, data: Buffer | string) {
    if (path.basename(file).startsWith("owner.json")) {
      this.takeOver();
    }
    return super.writeFile(file, data);
  }
}

/**
 * {@link TakenOverOwnerFileSystem}, except that each read of `owner.json`
 * fails with `EBUSY`, as on Windows while its owner renames it.
 */
class BusyOwnerFileSystem extends TakenOverOwnerFileSystem {
  override readFileString(file: string, encoding?: BufferEncoding) {
    if (path.basename(file) === "owner.json") {
      return Promise.reject(
        Object.assign(new Error("EBUSY: resource busy or locked"), {
          code: "EBUSY",
        }),
      );
    }
    return super.readFileString(file, encoding);
  }
}

/**
 * The real file system, except that renaming a temporary file onto
 * `owner.json` takes effect and then fails with `EIO`, as a network file
 * system can report a write it made.
 */
class RenamedThenFailingFileSystem extends NodeFileSystem {
  override async rename(source: string, target: string) {
    await super.rename(source, target);
    if (path.basename(target) === "owner.json") {
      throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
    }
  }
}

describe("ModuleCache prune across processes and failures", () => {
  let root: string;
  let cachePath: string;

  beforeEach(() => {
    root = makeTempDir("ajs-cache-prune-failures-");
    cachePath = path.join(root, "cache");
    seedCache(cachePath, ["a@1.0.0", "b@1.0.0", "@scope/c@1.0.0"]);
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("keeps the entries the lease of a live run in another process names", async () => {
    const other = await startIdleProcess();
    try {
      writeLease(cachePath, "other.json", {
        ...thisProcess(),
        pid: other.pid,
        entries: ["a@1.0.0"],
      });

      await prune(cachePath);

      expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(true);
      expect(hasEntryFolder(cachePath, "b@1.0.0")).to.equal(false);
    } finally {
      await other.stop();
    }
  });

  it("ignores and deletes an unreadable lease whose name is a run on this machine that has exited", async () => {
    writeLeaseText(cachePath, leaseNameOf({ pid: deadPid() }), "");

    await prune(cachePath);

    expect(manifestKeys(cachePath)).to.deep.equal([]);
    expect(leaseNames(cachePath)).to.deep.equal([]);
  });

  for (const { label, name } of [
    {
      label: "a live run of this machine",
      name: () => leaseNameOf({ pid: process.pid }),
    },
    {
      label: "a run of another machine",
      name: () =>
        leaseNameOf({ host: `${os.hostname()}-elsewhere`, pid: deadPid() }),
    },
    {
      label: "a run of this hostname in another pid namespace",
      name: () => leaseNameOf({ namespace: otherNamespace(), pid: deadPid() }),
    },
  ]) {
    it(`removes nothing when an unreadable lease names ${label}`, async () => {
      writeLeaseText(cachePath, name(), "");

      await assert.rejects(prune(cachePath), /JSON/);

      expect(manifestKeys(cachePath)).to.have.length(3);
      expect(leaseNames(cachePath)).to.have.length(1);
    });
  }

  it("never moves a manifest key outside the cache, under a dot folder, or not spelled as its folder", async () => {
    const outside = path.join(root, "outside@1.0.0");
    mkdirSync(outside);
    await new ModuleCache(cachePath).getFolder("a@1.0.0", true, true);
    const odd = ["../outside@1.0.0", ".leases", "x/../a@1.0.0"];
    writeJson(
      path.join(cachePath, "manifest.json"),
      Object.fromEntries([...odd, "b@1.0.0"].map((key) => [key, "1.0.0"])),
    );

    await prune(cachePath);

    expect(existsSync(outside)).to.equal(true);
    expect(leaseNames(cachePath)).to.have.length(1);
    expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(true);
    expect(hasEntryFolder(cachePath, "b@1.0.0")).to.equal(false);
    expect(manifestKeys(cachePath)).to.have.members(odd);
  });

  it("removes the folders it can move and keeps the entry of one it cannot", async () => {
    const locked = path.join(cachePath, "b@1.0.0");
    const fs = new RefusingFileSystem((file) => file === locked);

    await new ModuleCache(cachePath, fs).prune(async () => KEEP_NOTHING);

    expect(manifestKeys(cachePath)).to.deep.equal(["b@1.0.0"]);
    expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(false);
    expect(hasEntryFolder(cachePath, "b@1.0.0")).to.equal(true);
  });
});

describe("ModuleCache prune that cannot record its lock owner", () => {
  let root: string;
  let cachePath: string;

  beforeEach(() => {
    root = makeTempDir("ajs-cache-prune-owner-");
    cachePath = path.join(root, "cache");
    seedCache(cachePath, ["a@1.0.0", "b@1.0.0", "@scope/c@1.0.0"]);
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("releases the lock when it cannot record its owner", async () => {
    const fs = new FailingOwnerFileSystem();

    await assert.rejects(
      new ModuleCache(cachePath, fs).prune(async () => KEEP_NOTHING),
      /ENOSPC/,
    );

    expect(existsSync(pruneLockPath(cachePath))).to.equal(false);
    expect(manifestKeys(cachePath)).to.have.length(3);
  });

  it("leaves the lock another prune took over while it failed to record its owner", async () => {
    const fs = new TakenOverOwnerFileSystem(() =>
      holdPruneLock(cachePath, { pid: process.pid, token: "taken-over" }),
    );

    await assert.rejects(
      new ModuleCache(cachePath, fs).prune(async () => KEEP_NOTHING),
      /ENOSPC/,
    );

    expect(readLockOwner(pruneLockPath(cachePath))?.token).to.equal(
      "taken-over",
    );
    expect(manifestKeys(cachePath)).to.have.length(3);
  });

  it("leaves the lock whose owner.json exists but cannot be read for a moment when it failed to record its own", async () => {
    const fs = new BusyOwnerFileSystem(() =>
      holdPruneLock(cachePath, { pid: process.pid, token: "taken-over" }),
    );

    await assert.rejects(
      new ModuleCache(cachePath, fs).prune(async () => KEEP_NOTHING),
      /ENOSPC/,
    );

    expect(readLockOwner(pruneLockPath(cachePath))?.token).to.equal(
      "taken-over",
    );
  });

  it("releases the lock when its owner was written though the write reported a failure", async () => {
    const fs = new RenamedThenFailingFileSystem();

    await assert.rejects(
      new ModuleCache(cachePath, fs).prune(async () => KEEP_NOTHING),
      /EIO/,
    );

    expect(existsSync(pruneLockPath(cachePath))).to.equal(false);
  });

  it("leaves the lock whose owner.json cannot be read when it failed to record its own", async () => {
    const ownerFile = path.join(pruneLockPath(cachePath), "owner.json");
    const fs = new TakenOverOwnerFileSystem(() =>
      writeFileSync(ownerFile, "{"),
    );

    await assert.rejects(
      new ModuleCache(cachePath, fs).prune(async () => KEEP_NOTHING),
      /ENOSPC/,
    );

    expect(existsSync(ownerFile)).to.equal(true);
  });
});
