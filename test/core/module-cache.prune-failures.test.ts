import { expect } from "chai";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { type CacheKeep, ModuleCache } from "../../src/core/modules";
import {
  deadPid,
  FailingOwnerFileSystem,
  hasEntryFolder,
  hostnameInLeaseName,
  leaseNames,
  manifestKeys,
  pruneLockPath,
  seedCache,
  startIdleProcess,
  writeLease,
  writeLeaseText,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir } from "../helpers/temp";

const KEEP_NOTHING: CacheKeep = () => false;
const READ_ONLY_MODE = 0o555;
const WRITABLE_MODE = 0o755;

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
        host: os.hostname(),
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
    const name = `${hostnameInLeaseName()}-${deadPid()}-${randomUUID()}.json`;
    writeLeaseText(cachePath, name, "");

    await prune(cachePath);

    expect(manifestKeys(cachePath)).to.deep.equal([]);
    expect(leaseNames(cachePath)).to.deep.equal([]);
  });

  it("removes the folders it can move and keeps the entry of one it cannot", async () => {
    const locked = path.join(cachePath, "b@1.0.0");
    chmodSync(locked, READ_ONLY_MODE);
    try {
      await prune(cachePath);
    } finally {
      chmodSync(locked, WRITABLE_MODE);
    }

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
