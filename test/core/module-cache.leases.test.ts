import { expect } from "chai";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ModuleCache } from "../../src/core/modules";
import {
  CHILD_TIMEOUT_MS,
  openGate,
  pruneInChild,
  runInChild,
} from "../helpers/cache-children";
import {
  hasEntryFolder,
  holdPruneLock,
  leaseNames,
  manifestKeys,
  pruneLockPath,
  readLeases,
  readLockOwner,
  seedCache,
  thisProcess,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir } from "../helpers/temp";

const MODULE_CACHE_SOURCE = path.resolve(__dirname, "../../src/core/modules");
const PENDING_WINDOW_MS = 200;
const quoted = JSON.stringify;

function settlesWithin(promise: Promise<unknown>, ms: number) {
  const timeout = new Promise<false>((resolve) =>
    setTimeout(() => resolve(false), ms).unref(),
  );
  return Promise.race([promise.then(() => true), timeout]);
}

/** Runs a Node child that claims `entry` in the cache, prints its lease file names, and exits. */
function claimInChild(cachePath: string, entry: string): Promise<string> {
  return runInChild(
    [
      `const { ModuleCache } = require(${quoted(MODULE_CACHE_SOURCE)});`,
      `const cache = new ModuleCache(${quoted(cachePath)});`,
      `cache.getFolder(${quoted(entry)}, true, true).then(() => {`,
      `  const leases = require("node:path").join(${quoted(cachePath)}, ".leases");`,
      `  process.stdout.write(JSON.stringify(require("node:fs").readdirSync(leases)));`,
      `});`,
    ].join("\n"),
  ).exited;
}

describe("ModuleCache run leases", () => {
  let root: string;
  let cachePath: string;

  beforeEach(() => {
    root = makeTempDir("ajs-cache-leases-");
    cachePath = path.join(root, "cache");
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("names the entry in this run's lease before getFolder returns", async () => {
    const cache = new ModuleCache(cachePath);

    await cache.getFolder("@scope/pkg@1.0.0", true, true);

    expect(readLeases(cachePath)).to.deep.equal([
      { ...thisProcess(), entries: ["@scope/pkg@1.0.0"] },
    ]);
  });

  it("keeps one lease per cache naming every folder it claims inside the cache", async () => {
    const cache = new ModuleCache(cachePath);

    await Promise.all([
      cache.getFolder("a@1.0.0", true, true),
      cache.getFolder("b@1.0.0", true, true),
      cache.claimFolder(path.join(cachePath, "c@1.0.0", "sub")),
      cache.claimFolder(path.join(root, "outside")),
      cache.claimFolder(cachePath),
    ]);
    await cache.getFolder("a@1.0.0", true, true);

    expect(readLeases(cachePath)).to.deep.equal([
      { ...thisProcess(), entries: ["a@1.0.0", "b@1.0.0", "c@1.0.0/sub"] },
    ]);
  });

  it("gives each cache instance its own lease", async () => {
    await new ModuleCache(cachePath).getFolder("a@1.0.0", true, true);
    await new ModuleCache(cachePath).getFolder("b@1.0.0", true, true);

    expect(leaseNames(cachePath)).to.have.length(2);
  });

  it("waits while a prune in another process holds the lock, then finds the folder it removed gone", async function () {
    this.timeout(CHILD_TIMEOUT_MS + 5000);
    seedCache(cachePath, ["a@1.0.0"]);
    const goFile = path.join(root, "go");
    const pruner = pruneInChild(cachePath, goFile);
    try {
      await pruner.printed("ready");
      const claimed = new ModuleCache(cachePath)
        .getFolder("a@1.0.0", true, true)
        .then((folder) => existsSync(folder));

      expect(await settlesWithin(claimed, PENDING_WINDOW_MS)).to.equal(false);
      writeFileSync(goFile, "");
      expect(await claimed).to.equal(false);
      await pruner.exited;
      expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(false);
    } finally {
      writeFileSync(goFile, "");
      await pruner.exited.catch(() => undefined);
    }
  });

  it("makes a prune that loses its lock after reading the leases move nothing, and leave the new holder's lock", async function () {
    this.timeout(CHILD_TIMEOUT_MS + 5000);
    seedCache(cachePath, ["a@1.0.0", "b@1.0.0"]);
    const goFile = path.join(root, "go");
    const pruner = pruneInChild(cachePath, goFile);
    try {
      await pruner.printed("ready");
      holdPruneLock(cachePath, { pid: process.pid, token: "taken-over" });
      openGate(goFile);
      await pruner.exited;
    } finally {
      openGate(goFile);
      await pruner.exited.catch(() => undefined);
    }

    expect(manifestKeys(cachePath)).to.deep.equal(["a@1.0.0", "b@1.0.0"]);
    expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(true);
    expect(hasEntryFolder(cachePath, "b@1.0.0")).to.equal(true);
    expect(readLockOwner(pruneLockPath(cachePath))?.token).to.equal(
      "taken-over",
    );
  });

  it("removes the lease when the process that claimed exits", async function () {
    this.timeout(CHILD_TIMEOUT_MS + 5000);

    const whileRunning: unknown = JSON.parse(
      await claimInChild(cachePath, "a@1.0.0"),
    );

    expect(whileRunning).to.be.an("array").with.length(1);
    expect(leaseNames(cachePath)).to.deep.equal([]);
  });
});
