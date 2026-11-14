import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import { tsConfigFileModule as tsConfigFile } from "../../../src/core/config";
import { NodeFileSystem } from "../../../src/core/filesystem";
import {
  createBuildArtifact,
  getBuildArtifactPath,
  ModuleCache,
  writeBuildArtifact,
} from "../../../src/core/modules";
import {
  prepareFromArtifact,
  prepareFromRefreshedArtifact,
} from "../../../src/core/runtime";
import { openGate, pruneInChild } from "../../helpers/cache-children";
import {
  holdPruneLock,
  pruneLockPath,
  readLeases,
  seedCache,
} from "../../helpers/cache-leases";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

const fs = new NodeFileSystem();
const FIRST = "a@1.0.0";
const REBUILT = "a@2.0.0";
const SOURCE = {
  type: "package",
  package: "a",
  version: "^1.0.0",
} as const;
const CONFIG: AntelopeConfig = {
  name: "built",
  modules: { built: { source: SOURCE } },
};

/** Writes a `build.json` for `project` whose only module lives in `folder` of the cache at `cachePath`. */
async function writeBuild(
  project: string,
  cachePath: string,
  folder: string,
): Promise<void> {
  const modulePath = path.join(cachePath, folder);
  const artifact = createBuildArtifact({
    configHash: "hash",
    env: "default",
    config: {
      name: "built",
      cacheFolder: cachePath,
      projectFolder: project,
      envOverrides: {},
    },
    modules: {
      built: {
        folder: modulePath,
        source: { ...SOURCE, id: "built" },
        name: "built",
        main: path.join(modulePath, "index.js"),
        manifest: { name: "built", version: "1.0.0" },
        baseUrl: modulePath,
        paths: [],
      },
    },
  });
  await writeBuildArtifact(project, artifact, fs);
}

/** How many lease files of the cache at `cachePath` name `entry`. */
function leasesNaming(cachePath: string, entry: string): number {
  return readLeases(cachePath).filter((lease) =>
    JSON.stringify(lease).includes(JSON.stringify(entry)),
  ).length;
}

/** Resolves once a lease of the cache at `cachePath` names `entry`. */
async function leased(cachePath: string, entry: string): Promise<void> {
  while (
    !JSON.stringify(readLeases(cachePath)).includes(JSON.stringify(entry))
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

type Prepare = typeof prepareFromArtifact;

describe("ajs project start while another run rebuilds and prunes", () => {
  let root: string;
  let cachePath: string;
  let project: string;

  beforeEach(() => {
    root = makeTempDir("ajs-start-build-race-");
    cachePath = path.join(root, "cache");
    project = path.join(root, "project");
    mkdirSync(project);
    seedCache(cachePath, [FIRST, REBUILT]);
  });

  afterEach(() => {
    sinon.restore();
    cleanupTempDir(root);
  });

  /**
   * Prepares `start` with `prepare` from a `build.json` of {@link FIRST},
   * then, while a prune in a child process has read the leases and waits,
   * lets `start` claim, rewrites `build.json` to {@link REBUILT} and lets
   * the prune remove {@link FIRST}. The lease of this test keeps
   * {@link REBUILT} from that prune, as the lease of the build would.
   *
   * @returns the module folders `start` then loads.
   */
  async function startWhileRebuilt(prepare: Prepare): Promise<string[]> {
    await writeBuild(project, cachePath, FIRST);
    await new ModuleCache(cachePath).claimFolder(path.join(cachePath, REBUILT));
    const gate = path.join(root, "prune-go");
    const pruning = pruneInChild(cachePath, gate);
    await pruning.printed("ready");

    const prepared = await prepare(project, "default");
    const verified = prepared.verify(new AbortController().signal);
    await leased(cachePath, FIRST);
    await writeBuild(project, cachePath, REBUILT);
    openGate(gate);
    await pruning.exited;
    await verified;
    const entries = await prepared.createEntries();

    expect(existsSync(path.join(cachePath, FIRST))).to.equal(false);
    expect(leasesNaming(cachePath, REBUILT)).to.equal(2);
    return entries.map(({ manifest }) => manifest.folder);
  }

  it("starts the new build when a prune removes the folders of the build.json it read before it claimed them", async () => {
    expect(await startWhileRebuilt(prepareFromArtifact)).to.deep.equal([
      path.join(cachePath, REBUILT),
    ]);
  });

  it("starts the new build with --refresh-config, and resolves antelope.config.ts once", async () => {
    writeFileSync(path.join(project, "antelope.config.ts"), "");
    const evaluate = sinon
      .stub(tsConfigFile, "loadTsConfigFile")
      .resolves(CONFIG);

    expect(await startWhileRebuilt(prepareFromRefreshedArtifact)).to.deep.equal(
      [path.join(cachePath, REBUILT)],
    );
    expect(evaluate.callCount).to.equal(1);
  });
});

describe("ajs project start while another build rewrites build.json", () => {
  let root: string;
  let cachePath: string;
  let project: string;

  beforeEach(() => {
    root = makeTempDir("ajs-start-build-rewrite-");
    cachePath = path.join(root, "cache");
    project = path.join(root, "project");
    mkdirSync(project);
    seedCache(cachePath, [FIRST]);
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("starts the build it claimed when build.json is gone as it reads it again", async () => {
    await writeBuild(project, cachePath, FIRST);
    holdPruneLock(cachePath, { pid: process.pid });
    const prepared = await prepareFromArtifact(project, "default");
    const verified = prepared.verify(new AbortController().signal);

    await leased(cachePath, FIRST);
    rmSync(path.dirname(getBuildArtifactPath(project)), { recursive: true });
    rmSync(pruneLockPath(cachePath), { recursive: true });
    await verified;
    const entries = await prepared.createEntries();

    expect(entries.map(({ manifest }) => manifest.folder)).to.deep.equal([
      path.join(cachePath, FIRST),
    ]);
  });

  it("starts the build it claimed when the new build.json names another cache", async () => {
    const otherCache = path.join(root, "other-cache");
    seedCache(otherCache, [REBUILT]);
    await writeBuild(project, cachePath, FIRST);
    const prepared = await prepareFromArtifact(project, "default");

    await writeBuild(project, otherCache, REBUILT);
    await prepared.verify(new AbortController().signal);
    const entries = await prepared.createEntries();

    expect(entries.map(({ manifest }) => manifest.folder)).to.deep.equal([
      path.join(cachePath, FIRST),
    ]);
  });
});
