import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";

import { NodeFileSystem } from "../../../src/core/filesystem";
import {
  ModuleCache,
  createBuildArtifact,
  writeBuildArtifact,
} from "../../../src/core/modules";
import { pruneModuleCache } from "../../../src/core/runtime";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

const CONFIG = `export default {
  name: "pruning",
  modules: {
    pinned: { source: { type: "package", package: "pinned", version: "^2.0.0" } },
  },
  environments: {
    production: {
      modules: {
        repo: { source: { type: "git", remote: "https://example.com/repo.git" } },
        pre: { source: { type: "package", package: "pre", version: "next" } },
        tagged: { source: { type: "package", package: "tagged", version: "latest" } },
      },
    },
  },
};
`;

const STALE = {
  pinned: "1.0.0",
  "pinned@1.0.0": "1.0.0",
  "dropped@1.0.0": "1.0.0",
  "pinned@2.0.0": "2.0.0",
  "tagged@2.0.0": "2.0.0",
  "pre@1.0.0": "1.0.0",
};

const KEPT = {
  "pinned@2.1.0": "2.1.0",
  "tagged@3.0.0": "3.0.0",
  "pre@2.0.0-beta.1": "2.0.0-beta.1",
  https___example_com_repo_git: "git:main:abc",
};

describe("pruneModuleCache", () => {
  let project: string;

  beforeEach(async () => {
    project = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ajs-prune-"));
    await fsPromises.writeFile(
      path.join(project, "antelope.config.ts"),
      CONFIG,
    );
  });

  afterEach(async () => {
    await fsPromises.rm(project, { recursive: true, force: true });
  });

  it("keeps what any environment declares and removes the rest", async () => {
    const cacheFs = new InMemoryFileSystem();
    await cacheFs.writeFile(
      "/cache/manifest.json",
      JSON.stringify({ ...STALE, ...KEPT }),
    );
    const cache = new ModuleCache("/cache", cacheFs);
    await cache.load();

    await pruneModuleCache(cache, project, new NodeFileSystem());

    expect(Object.fromEntries(cache.entries())).to.deep.equal(KEPT);
  });

  it("keeps what build.json points at for an environment the configuration does not list", async () => {
    await fsPromises.writeFile(
      path.join(project, "antelope.config.ts"),
      `export default (ctx: { env: string }) => ({
        name: "pruning",
        modules: ctx.env === "production"
          ? { db: { source: { type: "package", package: "@scope/real-db", version: "^1.0.0" } } }
          : { db: { source: { type: "package", package: "mock-db", version: "^1.0.0" } } },
      });\n`,
    );
    const folder = "/cache/@scope/real-db@1.0.0";
    const source: ModuleSourcePackage = {
      type: "package",
      package: "@scope/real-db",
      version: "^1.0.0",
    };
    await writeBuildArtifact(
      project,
      createBuildArtifact({
        configHash: "hash",
        env: "production",
        config: {
          name: "pruning",
          cacheFolder: "/cache",
          projectFolder: project,
          envOverrides: {},
        },
        modules: {
          db: {
            folder,
            source,
            name: "@scope/real-db",
            main: `${folder}/index.js`,
            manifest: { name: "@scope/real-db", version: "1.0.0" },
            baseUrl: folder,
            paths: [],
          },
        },
      }),
      new NodeFileSystem(),
    );
    const cacheFs = new InMemoryFileSystem();
    await cacheFs.writeFile(
      "/cache/manifest.json",
      JSON.stringify({
        "mock-db@1.0.0": "1.0.0",
        "@scope/real-db@1.0.0": "1.0.0",
      }),
    );
    const cache = new ModuleCache("/cache", cacheFs);
    await cache.load();

    await pruneModuleCache(cache, project, new NodeFileSystem());

    expect(Object.fromEntries(cache.entries())).to.deep.equal({
      "mock-db@1.0.0": "1.0.0",
      "@scope/real-db@1.0.0": "1.0.0",
    });
  });

  it("leaves the cache as it is when the configuration cannot be read", async () => {
    await fsPromises.rm(path.join(project, "antelope.config.ts"));
    const cacheFs = new InMemoryFileSystem();
    await cacheFs.writeFile("/cache/manifest.json", JSON.stringify(STALE));
    const cache = new ModuleCache("/cache", cacheFs);
    await cache.load();

    await pruneModuleCache(cache, project, new NodeFileSystem());

    expect(Object.fromEntries(cache.entries())).to.deep.equal(STALE);
  });
});
