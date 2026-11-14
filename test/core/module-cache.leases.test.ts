import { expect } from "chai";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ModuleCache } from "../../src/core/modules";
import {
  deadPid,
  holdPruneLock,
  leaseNames,
  pruneLockPath,
  readLeases,
  VanishingFileSystem,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir } from "../helpers/temp";

const REPO_ROOT = path.resolve(__dirname, "../..");
const MODULE_CACHE_SOURCE = path.join(REPO_ROOT, "src/core/modules");
const CHILD_TIMEOUT_MS = 30_000;
const PENDING_WINDOW_MS = 200;

function settlesWithin(promise: Promise<unknown>, ms: number) {
  const timeout = new Promise<false>((resolve) =>
    setTimeout(() => resolve(false), ms).unref(),
  );
  return Promise.race([promise.then(() => true), timeout]);
}

/** Runs a Node child that claims `entry` in the cache, prints its lease file names, and exits. */
function claimInChild(cachePath: string, entry: string): Promise<string> {
  const script = [
    `const { ModuleCache } = require(${JSON.stringify(MODULE_CACHE_SOURCE)});`,
    `const cache = new ModuleCache(${JSON.stringify(cachePath)});`,
    `cache.getFolder(${JSON.stringify(entry)}, true, true).then(() => {`,
    `  const leases = require("node:path").join(${JSON.stringify(cachePath)}, ".leases");`,
    `  process.stdout.write(JSON.stringify(require("node:fs").readdirSync(leases)));`,
    `});`,
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["-r", "ts-node/register", "-e", script],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "true" },
        timeout: CHILD_TIMEOUT_MS,
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(output) : reject(new Error(output)),
    );
  });
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
      { host: os.hostname(), pid: process.pid, entries: ["@scope/pkg@1.0.0"] },
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
      {
        host: os.hostname(),
        pid: process.pid,
        entries: ["a@1.0.0", "b@1.0.0", "c@1.0.0/sub"],
      },
    ]);
  });

  it("gives each cache instance its own lease", async () => {
    await new ModuleCache(cachePath).getFolder("a@1.0.0", true, true);
    await new ModuleCache(cachePath).getFolder("b@1.0.0", true, true);

    expect(leaseNames(cachePath)).to.have.length(2);
  });

  it("waits while a live prune holds the cache, then returns once it is released", async () => {
    holdPruneLock(cachePath, process.pid);
    const claimed = new ModuleCache(cachePath).getFolder("a@1.0.0", true, true);

    expect(await settlesWithin(claimed, PENDING_WINDOW_MS)).to.equal(false);
    expect(readLeases(cachePath)).to.have.length(1);

    rmSync(pruneLockPath(cachePath), { recursive: true });
    expect(await settlesWithin(claimed, 2000)).to.equal(true);
  });

  for (const { label, hold } of [
    {
      label: "whose owner on this machine has exited",
      hold: (cache: string) => holdPruneLock(cache, deadPid()),
    },
    {
      label: "older than a minute",
      hold: (cache: string) => holdPruneLock(cache, process.pid, true),
    },
  ]) {
    it(`does not wait for a prune lock ${label}`, async () => {
      hold(cachePath);

      const claimed = new ModuleCache(cachePath).getFolder(
        "a@1.0.0",
        true,
        true,
      );

      expect(await settlesWithin(claimed, 2000)).to.equal(true);
    });
  }

  it("does not wait for a prune lock released while the claim reads it", async () => {
    holdPruneLock(cachePath, process.pid);
    const fs = new VanishingFileSystem(pruneLockPath(cachePath));

    const claimed = new ModuleCache(cachePath, fs).getFolder(
      "a@1.0.0",
      true,
      true,
    );

    expect(await settlesWithin(claimed, 2000)).to.equal(true);
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
