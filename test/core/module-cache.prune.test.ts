import { expect } from "chai";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { type CacheKeep, ModuleCache } from "../../src/core/modules";
import {
  cacheFolderNames,
  deadPid,
  hasEntryFolder,
  leaseNames,
  manifestKeys,
  otherNamespace,
  pruneLockPath,
  seedCache,
  thisProcess,
  writeLease,
  VanishingFileSystem,
  writeLeaseText,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir, writeJson } from "../helpers/temp";

const KEEP_NOTHING: CacheKeep = () => false;

function prune(cachePath: string, keep: CacheKeep = KEEP_NOTHING) {
  return new ModuleCache(cachePath).prune(async () => keep);
}

describe("ModuleCache prune", () => {
  let root: string;
  let cachePath: string;

  beforeEach(() => {
    root = makeTempDir("ajs-cache-prune-");
    cachePath = path.join(root, "cache");
    seedCache(cachePath, ["a@1.0.0", "b@1.0.0", "@scope/c@1.0.0"]);
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("removes every entry no live lease covers and keeps the leased ones", async () => {
    const run = new ModuleCache(cachePath);
    await run.getFolder("a@1.0.0", true, true);
    await run.claimFolder(path.join(cachePath, "@scope", "c@1.0.0", "lib"));

    await prune(cachePath);

    expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(true);
    expect(hasEntryFolder(cachePath, "@scope/c@1.0.0")).to.equal(true);
    expect(hasEntryFolder(cachePath, "b@1.0.0")).to.equal(false);
    expect(manifestKeys(cachePath)).to.deep.equal([
      "@scope/c@1.0.0",
      "a@1.0.0",
    ]);
    expect(cacheFolderNames(cachePath, ".trash")).to.deep.equal([]);
  });

  it("keeps the entries the keep rule claims", async () => {
    await prune(cachePath, (entry) => entry === "b@1.0.0");

    expect(manifestKeys(cachePath)).to.deep.equal(["b@1.0.0"]);
    expect(hasEntryFolder(cachePath, "b@1.0.0")).to.equal(true);
    expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(false);
  });

  it("ignores and deletes the lease of a run on this machine that has exited", async () => {
    writeLease(cachePath, "dead.json", {
      ...thisProcess(),
      pid: deadPid(),
      entries: ["a@1.0.0"],
    });

    await prune(cachePath);

    expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(false);
    expect(leaseNames(cachePath)).to.deep.equal([]);
  });

  it("keeps the entries a lease from another machine names", async () => {
    writeLease(cachePath, "remote.json", {
      ...thisProcess(),
      host: `${os.hostname()}-elsewhere`,
      pid: deadPid(),
      entries: ["a@1.0.0"],
    });

    await prune(cachePath);

    expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(true);
    expect(leaseNames(cachePath)).to.deep.equal(["remote.json"]);
  });

  it("keeps the entries and the file of a lease from another pid namespace of this hostname", async () => {
    writeLease(cachePath, "container.json", {
      ...thisProcess(),
      namespace: otherNamespace(),
      pid: deadPid(),
      entries: ["a@1.0.0"],
    });

    await prune(cachePath);

    expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(true);
    expect(leaseNames(cachePath)).to.deep.equal(["container.json"]);
  });

  it("reads only the .json files of the lease folder", async () => {
    writeLeaseText(cachePath, "partial.json.tmp", "{ not json");

    await prune(cachePath);

    expect(manifestKeys(cachePath)).to.deep.equal([]);
  });

  for (const { label, content } of [
    { label: "is not JSON", content: "{" },
    {
      label: "names its entries as a string",
      content: JSON.stringify({
        host: "h",
        namespace: "none",
        pid: 1,
        entries: "a@1.0.0",
      }),
    },
  ]) {
    it(`removes nothing when a lease ${label}`, async () => {
      writeLeaseText(cachePath, "broken.json", content);

      await assert.rejects(prune(cachePath), /lease|JSON/);

      expect(manifestKeys(cachePath)).to.have.length(3);
      expect(hasEntryFolder(cachePath, "b@1.0.0")).to.equal(true);
      expect(existsSync(pruneLockPath(cachePath))).to.equal(false);
    });
  }

  it("skips a lease that its run deletes while the prune reads it", async () => {
    writeLease(cachePath, "exiting.json", {
      ...thisProcess(),
      entries: ["a@1.0.0"],
    });
    const exiting = path.join(cachePath, ".leases", "exiting.json");

    await new ModuleCache(cachePath, new VanishingFileSystem(exiting)).prune(
      async () => KEEP_NOTHING,
    );

    expect(manifestKeys(cachePath)).to.deep.equal([]);
  });

  it("drops the manifest key of an entry whose folder is already gone", async () => {
    writeJson(path.join(cachePath, "manifest.json"), {
      "a@1.0.0": "1.0.0",
      "ghost@1.0.0": "1.0.0",
    });

    await prune(cachePath, (entry) => entry === "a@1.0.0");

    expect(manifestKeys(cachePath)).to.deep.equal(["a@1.0.0"]);
  });

  it("leaves every folder the manifest does not list, and empties leftover trash", async () => {
    writeJson(path.join(cachePath, "instances", "x", "file.json"), {});
    writeJson(path.join(cachePath, "installing@2.0.0", "package.json"), {});
    writeJson(path.join(cachePath, ".trash", "left-over", "file.json"), {});

    await prune(cachePath);

    expect(hasEntryFolder(cachePath, "instances/x")).to.equal(true);
    expect(hasEntryFolder(cachePath, "installing@2.0.0")).to.equal(true);
    expect(cacheFolderNames(cachePath, ".trash")).to.deep.equal([]);
  });
});
