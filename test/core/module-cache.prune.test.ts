import { Logging } from "@antelopejs/interface-core/logging";
import { expect } from "chai";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as sinon from "sinon";

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

/** A fresh cache holding `a`, `b` and `@scope/c` for each test, under a temporary root. */
function useSeededCache() {
  const seeded = { root: "", cachePath: "" };

  beforeEach(() => {
    seeded.root = makeTempDir("ajs-cache-prune-");
    seeded.cachePath = path.join(seeded.root, "cache");
    seedCache(seeded.cachePath, ["a@1.0.0", "b@1.0.0", "@scope/c@1.0.0"]);
  });

  afterEach(() => {
    cleanupTempDir(seeded.root);
  });

  return seeded;
}

describe("ModuleCache prune", () => {
  const seeded = useSeededCache();

  it("removes every entry no live lease covers and keeps the leased ones", async () => {
    const run = new ModuleCache(seeded.cachePath);
    await run.getFolder("a@1.0.0", true, true);
    await run.claimFolder(
      path.join(seeded.cachePath, "@scope", "c@1.0.0", "lib"),
    );

    await prune(seeded.cachePath);

    expect(hasEntryFolder(seeded.cachePath, "a@1.0.0")).to.equal(true);
    expect(hasEntryFolder(seeded.cachePath, "@scope/c@1.0.0")).to.equal(true);
    expect(hasEntryFolder(seeded.cachePath, "b@1.0.0")).to.equal(false);
    expect(manifestKeys(seeded.cachePath)).to.deep.equal([
      "@scope/c@1.0.0",
      "a@1.0.0",
    ]);
    expect(cacheFolderNames(seeded.cachePath, ".trash")).to.deep.equal([]);
  });

  it("keeps the entries the keep rule claims", async () => {
    await prune(seeded.cachePath, (entry) => entry === "b@1.0.0");

    expect(manifestKeys(seeded.cachePath)).to.deep.equal(["b@1.0.0"]);
    expect(hasEntryFolder(seeded.cachePath, "b@1.0.0")).to.equal(true);
    expect(hasEntryFolder(seeded.cachePath, "a@1.0.0")).to.equal(false);
  });

  it("drops the manifest key of an entry whose folder is already gone", async () => {
    writeJson(path.join(seeded.cachePath, "manifest.json"), {
      "a@1.0.0": "1.0.0",
      "ghost@1.0.0": "1.0.0",
    });

    await prune(seeded.cachePath, (entry) => entry === "a@1.0.0");

    expect(manifestKeys(seeded.cachePath)).to.deep.equal(["a@1.0.0"]);
  });

  it("leaves every folder the manifest does not list, and empties leftover trash", async () => {
    writeJson(path.join(seeded.cachePath, "instances", "x", "file.json"), {});
    writeJson(
      path.join(seeded.cachePath, "installing@2.0.0", "package.json"),
      {},
    );
    writeJson(
      path.join(seeded.cachePath, ".trash", "left-over", "file.json"),
      {},
    );

    await prune(seeded.cachePath);

    expect(hasEntryFolder(seeded.cachePath, "instances/x")).to.equal(true);
    expect(hasEntryFolder(seeded.cachePath, "installing@2.0.0")).to.equal(true);
    expect(cacheFolderNames(seeded.cachePath, ".trash")).to.deep.equal([]);
  });
});

describe("ModuleCache prune reading the leases of other runs", () => {
  const seeded = useSeededCache();

  it("ignores and deletes the lease of a run on this machine that has exited", async () => {
    writeLease(seeded.cachePath, "dead.json", {
      ...thisProcess(),
      pid: deadPid(),
      entries: ["a@1.0.0"],
    });

    await prune(seeded.cachePath);

    expect(hasEntryFolder(seeded.cachePath, "a@1.0.0")).to.equal(false);
    expect(leaseNames(seeded.cachePath)).to.deep.equal([]);
  });

  for (const { label, owner } of [
    {
      label: "another machine",
      owner: () => ({ host: `${os.hostname()}-elsewhere`, pid: deadPid() }),
    },
    {
      label: "this hostname in another pid namespace",
      owner: () => ({ namespace: otherNamespace(), pid: deadPid() }),
    },
  ]) {
    it(`removes nothing, keeps the lease, and warns naming its file, while a lease of ${label} is present`, async () => {
      const warn = sinon.stub(Logging.Channel.prototype, "Warn");
      const foreign = { ...thisProcess(), ...owner(), entries: ["a@1.0.0"] };
      writeLease(seeded.cachePath, "foreign.json", foreign);

      try {
        await prune(seeded.cachePath);
      } finally {
        warn.restore();
      }

      expect(manifestKeys(seeded.cachePath)).to.have.length(3);
      expect(hasEntryFolder(seeded.cachePath, "b@1.0.0")).to.equal(true);
      expect(leaseNames(seeded.cachePath)).to.deep.equal(["foreign.json"]);
      expect(warn.args.map(([message]) => String(message))).to.satisfy(
        (messages: string[]) =>
          messages.some((message) =>
            [String(foreign.pid), "foreign.json", "delete"].every((part) =>
              message.includes(part),
            ),
          ),
      );
    });
  }

  it("names every foreign lease in one warning", async () => {
    const warn = sinon.stub(Logging.Channel.prototype, "Warn");
    const machine = { ...thisProcess(), host: "elsewhere", pid: deadPid() };
    const container = { ...thisProcess(), namespace: otherNamespace() };
    writeLease(seeded.cachePath, "machine.json", { ...machine, entries: [] });
    writeLease(seeded.cachePath, "container.json", {
      ...container,
      pid: deadPid(),
      entries: [],
    });

    try {
      await prune(seeded.cachePath);
    } finally {
      warn.restore();
    }

    const naming = warn.args
      .map(([message]) => String(message))
      .filter((message) => message.includes(".json"));
    expect(naming).to.have.length(1);
    expect(naming[0]).to.include("machine.json").and.include("container.json");
  });

  it("reads only the .json files of the lease folder", async () => {
    writeLeaseText(seeded.cachePath, "partial.json.tmp", "{ not json");

    await prune(seeded.cachePath);

    expect(manifestKeys(seeded.cachePath)).to.deep.equal([]);
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
    it(`removes nothing, and names the lease file, when a lease ${label}`, async () => {
      writeLeaseText(seeded.cachePath, "broken.json", content);

      await assert.rejects(prune(seeded.cachePath), /broken\.json/);

      expect(manifestKeys(seeded.cachePath)).to.have.length(3);
      expect(hasEntryFolder(seeded.cachePath, "b@1.0.0")).to.equal(true);
      expect(existsSync(pruneLockPath(seeded.cachePath))).to.equal(false);
    });
  }

  it("skips a lease that its run deletes while the prune reads it", async () => {
    writeLease(seeded.cachePath, "exiting.json", {
      ...thisProcess(),
      entries: ["a@1.0.0"],
    });
    const exiting = path.join(seeded.cachePath, ".leases", "exiting.json");

    await new ModuleCache(
      seeded.cachePath,
      new VanishingFileSystem(exiting),
    ).prune(async () => KEEP_NOTHING);

    expect(manifestKeys(seeded.cachePath)).to.deep.equal([]);
  });
});
