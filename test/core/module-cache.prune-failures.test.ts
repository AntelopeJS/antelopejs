import { expect } from "chai";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { type CacheKeep, ModuleCache } from "../../src/core/modules";
import {
  deadPid,
  FailingOwnerFileSystem,
  hasEntryFolder,
  leaseNameOf,
  leaseNames,
  manifestKeys,
  otherNamespace,
  pruneLockPath,
  RefusingFileSystem,
  seedCache,
  startIdleProcess,
  thisProcess,
  writeLease,
  writeLeaseText,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir } from "../helpers/temp";

const KEEP_NOTHING: CacheKeep = () => false;

function prune(cachePath: string) {
  return new ModuleCache(cachePath).prune(async () => KEEP_NOTHING);
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

  it("removes the folders it can move and keeps the entry of one it cannot", async () => {
    const locked = path.join(cachePath, "b@1.0.0");
    const fs = new RefusingFileSystem((file) => file === locked);

    await new ModuleCache(cachePath, fs).prune(async () => KEEP_NOTHING);

    expect(manifestKeys(cachePath)).to.deep.equal(["b@1.0.0"]);
    expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(false);
    expect(hasEntryFolder(cachePath, "b@1.0.0")).to.equal(true);
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
});
