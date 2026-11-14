import { expect } from "chai";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { NodeFileSystem } from "../../../src/core/filesystem";
import {
  createBuildArtifact,
  getBuildArtifactPath,
  ModuleCache,
  writeBuildArtifact,
} from "../../../src/core/modules";
import { pruneModuleCache, writeBuildPin } from "../../../src/core/runtime";
import {
  cacheFolderNames,
  hasEntryFolder,
  leaseNames,
  manifestKeys,
  seedCache,
} from "../../helpers/cache-leases";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

const fs = new NodeFileSystem();
const NO_PRUNE_VARIABLE = "ANTELOPEJS_NO_CACHE_PRUNE";

/** Writes a `build.json` for `project` whose only module lives in `folder`. */
async function writeBuild(project: string, folder: string): Promise<string> {
  const artifact = createBuildArtifact({
    configHash: "hash",
    env: "default",
    config: {
      name: "built",
      cacheFolder: path.dirname(folder),
      projectFolder: project,
      envOverrides: {},
    },
    modules: {
      built: {
        folder,
        source: { type: "package" },
        name: "built",
        main: path.join(folder, "index.js"),
        manifest: { name: "built", version: "1.0.0" },
        baseUrl: folder,
        paths: [],
      },
    },
  });
  await writeBuildArtifact(project, artifact, fs);
  return getBuildArtifactPath(project);
}

describe("pruneModuleCache", () => {
  let root: string;
  let cachePath: string;
  let project: string;

  beforeEach(() => {
    root = makeTempDir("ajs-cache-pruning-");
    cachePath = path.join(root, "cache");
    project = path.join(root, "project");
    mkdirSync(project);
    seedCache(cachePath, ["a@1.0.0", "b@1.0.0"]);
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("keeps the module folders the project's own build.json points at", async () => {
    await writeBuild(project, path.join(cachePath, "a@1.0.0"));

    await pruneModuleCache(new ModuleCache(cachePath), project, fs);

    expect(manifestKeys(cachePath)).to.deep.equal(["a@1.0.0"]);
  });

  it("keeps the module folders a build.json names through a symbolic link to the cache", async () => {
    const link = path.join(root, "link");
    symlinkSync(root, link);
    await writeBuild(project, path.join(link, "cache", "a@1.0.0"));

    await pruneModuleCache(new ModuleCache(cachePath), project, fs);

    expect(manifestKeys(cachePath)).to.deep.equal(["a@1.0.0"]);
  });

  it("claims for a run the folder it names through a symbolic link to the cache", async () => {
    const link = path.join(root, "link");
    symlinkSync(root, link);
    await new ModuleCache(cachePath).claimFolder(
      path.join(link, "cache", "a@1.0.0"),
    );

    await pruneModuleCache(new ModuleCache(cachePath), project, fs);

    expect(manifestKeys(cachePath)).to.deep.equal(["a@1.0.0"]);
  });

  it("keeps the module folders of a pinned build of another project", async () => {
    const other = path.join(root, "other");
    const buildFile = await writeBuild(
      other,
      path.join(cachePath, "a@1.0.0", "dist"),
    );
    await writeBuildPin(cachePath, buildFile, fs);

    await pruneModuleCache(new ModuleCache(cachePath), project, fs);

    expect(manifestKeys(cachePath)).to.deep.equal(["a@1.0.0"]);
    expect(cacheFolderNames(cachePath, ".builds")).to.have.length(1);
  });

  it("deletes a pin whose build file is gone, and no longer keeps its folders", async () => {
    const other = path.join(root, "other");
    const buildFile = await writeBuild(other, path.join(cachePath, "a@1.0.0"));
    await writeBuildPin(cachePath, buildFile, fs);
    rmSync(other, { recursive: true });

    await pruneModuleCache(new ModuleCache(cachePath), project, fs);

    expect(cacheFolderNames(cachePath, ".builds")).to.deep.equal([]);
    expect(manifestKeys(cachePath)).to.deep.equal([]);
  });

  for (const { label, corrupt } of [
    {
      label: "the project's build.json",
      corrupt: () => {
        mkdirSync(path.dirname(getBuildArtifactPath(project)), {
          recursive: true,
        });
        writeFileSync(getBuildArtifactPath(project), "{");
      },
    },
    {
      label: "a build pin",
      corrupt: () => {
        mkdirSync(path.join(cachePath, ".builds"));
        writeFileSync(path.join(cachePath, ".builds", "pin.json"), "[]");
      },
    },
  ]) {
    it(`removes nothing, and does not throw, when ${label} cannot be read`, async () => {
      corrupt();

      await pruneModuleCache(new ModuleCache(cachePath), project, fs);

      expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(true);
      expect(manifestKeys(cachePath)).to.deep.equal(["a@1.0.0", "b@1.0.0"]);
    });
  }
});

describe("pruneModuleCache with ANTELOPEJS_NO_CACHE_PRUNE", () => {
  let root: string;
  let cachePath: string;
  let project: string;
  const saved = process.env[NO_PRUNE_VARIABLE];

  beforeEach(() => {
    root = makeTempDir("ajs-cache-no-prune-");
    cachePath = path.join(root, "cache");
    project = path.join(root, "project");
    mkdirSync(project);
    seedCache(cachePath, ["a@1.0.0", "b@1.0.0"]);
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[NO_PRUNE_VARIABLE];
    } else {
      process.env[NO_PRUNE_VARIABLE] = saved;
    }
    cleanupTempDir(root);
  });

  for (const value of ["1", " TRUE "]) {
    it(`removes nothing while it is ${JSON.stringify(value)}, though the run still writes its lease`, async () => {
      process.env[NO_PRUNE_VARIABLE] = value;
      const run = new ModuleCache(cachePath);
      await run.getFolder("a@1.0.0", true, true);

      await pruneModuleCache(run, project, fs);

      expect(manifestKeys(cachePath)).to.deep.equal(["a@1.0.0", "b@1.0.0"]);
      expect(hasEntryFolder(cachePath, "b@1.0.0")).to.equal(true);
      expect(leaseNames(cachePath)).to.have.length(1);
    });
  }

  it("prunes while it holds another value, such as 0", async () => {
    process.env[NO_PRUNE_VARIABLE] = "0";

    await pruneModuleCache(new ModuleCache(cachePath), project, fs);

    expect(manifestKeys(cachePath)).to.deep.equal([]);
  });
});
