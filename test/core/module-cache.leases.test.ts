import { expect } from "chai";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ModuleCache } from "../../src/core/modules";
import {
  hasEntryFolder,
  leaseNames,
  readLeases,
  seedCache,
  thisProcess,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir } from "../helpers/temp";

const REPO_ROOT = path.resolve(__dirname, "../..");
const MODULE_CACHE_SOURCE = path.join(REPO_ROOT, "src/core/modules");
const CHILD_TIMEOUT_MS = 30_000;
const PENDING_WINDOW_MS = 200;
const quoted = JSON.stringify;

function settlesWithin(promise: Promise<unknown>, ms: number) {
  const timeout = new Promise<false>((resolve) =>
    setTimeout(() => resolve(false), ms).unref(),
  );
  return Promise.race([promise.then(() => true), timeout]);
}

/**
 * Runs `script` in a Node child. `exited` resolves with what it printed once
 * it exits with code 0; `printed` resolves once it has printed `text`.
 */
function runInChild(script: string) {
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
  const exited = new Promise<string>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(output) : reject(new Error(output)),
    );
  });
  const printed = (text: string) =>
    new Promise<void>((resolve, reject) => {
      const check = () => output.includes(text) && resolve();
      child.stdout.on("data", check);
      exited.then(
        () => reject(new Error(`Exited without printing ${text}: ${output}`)),
        reject,
      );
      check();
    });
  return { exited, printed };
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

/**
 * Runs a Node child that prunes the cache, keeping nothing. Under the lock,
 * its keep rule prints `ready`, then waits for `goFile` before the prune goes
 * on.
 */
function pruneInChild(cachePath: string, goFile: string) {
  return runInChild(
    [
      `const { ModuleCache } = require(${quoted(MODULE_CACHE_SOURCE)});`,
      `const { existsSync } = require("node:fs");`,
      `const pause = () => new Promise((resolve) => setTimeout(resolve, 20));`,
      `new ModuleCache(${quoted(cachePath)}).prune(async () => {`,
      `  process.stdout.write("ready\\n");`,
      `  while (!existsSync(${quoted(goFile)})) await pause();`,
      `  return () => false;`,
      `});`,
    ].join("\n"),
  );
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

  it("removes the lease when the process that claimed exits", async function () {
    this.timeout(CHILD_TIMEOUT_MS + 5000);

    const whileRunning: unknown = JSON.parse(
      await claimInChild(cachePath, "a@1.0.0"),
    );

    expect(whileRunning).to.be.an("array").with.length(1);
    expect(leaseNames(cachePath)).to.deep.equal([]);
  });
});
