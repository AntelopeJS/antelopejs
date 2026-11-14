import { expect } from "chai";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { type CacheKeep, ModuleCache } from "../../src/core/modules";
import {
  deadPid,
  holdPruneLock,
  manifestKeys,
  otherNamespace,
  pruneLockPath,
  seedCache,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir } from "../helpers/temp";

const KEEP_NOTHING: CacheKeep = () => false;

function prune(cachePath: string) {
  return new ModuleCache(cachePath).prune(async () => KEEP_NOTHING);
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

  it("skips while a prune that has not yet written its owner holds the lock", async () => {
    mkdirSync(pruneLockPath(cachePath));

    await prune(cachePath);

    expect(manifestKeys(cachePath)).to.have.length(2);
  });

  for (const { label, owner } of [
    { label: "another live prune", owner: () => ({ pid: process.pid }) },
    {
      label: "a prune of this hostname in another pid namespace",
      owner: () => ({ namespace: otherNamespace(), pid: deadPid() }),
    },
    {
      label: "a prune of another machine",
      owner: () => ({ host: `${os.hostname()}-elsewhere`, pid: deadPid() }),
    },
  ]) {
    it(`skips while ${label} holds the lock`, async () => {
      holdPruneLock(cachePath, owner());

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
});
