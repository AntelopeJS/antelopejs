import { expect } from "chai";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { NodeFileSystem } from "../../../src/core/filesystem";
import {
  createBuildArtifact,
  ModuleCache,
  writeBuildArtifact,
} from "../../../src/core/modules";
import { prepareFromArtifact } from "../../../src/core/runtime";
import { openGate, pruneInChild } from "../../helpers/cache-children";
import { readLeases, seedCache } from "../../helpers/cache-leases";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

const fs = new NodeFileSystem();
const FIRST = "a@1.0.0";
const REBUILT = "a@2.0.0";

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
        source: { type: "package" },
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

/** Resolves once a lease of the cache at `cachePath` names `entry`. */
async function leased(cachePath: string, entry: string): Promise<void> {
  while (
    !JSON.stringify(readLeases(cachePath)).includes(JSON.stringify(entry))
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

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
    cleanupTempDir(root);
  });

  it("starts the new build when a prune removes the folders of the build.json it read before it claimed them", async () => {
    await writeBuild(project, cachePath, FIRST);
    await new ModuleCache(cachePath).claimFolder(path.join(cachePath, REBUILT));
    const gate = path.join(root, "prune-go");
    const pruning = pruneInChild(cachePath, gate);
    await pruning.printed("ready");

    const prepared = await prepareFromArtifact(project, "default");
    const verified = prepared.verify(new AbortController().signal);
    await leased(cachePath, FIRST);
    await writeBuild(project, cachePath, REBUILT);
    openGate(gate);
    await pruning.exited;
    await verified;
    const entries = await prepared.createEntries();

    expect(existsSync(path.join(cachePath, FIRST))).to.equal(false);
    expect(entries.map(({ manifest }) => manifest.folder)).to.deep.equal([
      path.join(cachePath, REBUILT),
    ]);
  });
});
