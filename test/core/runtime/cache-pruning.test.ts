import { expect } from "chai";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";

import { NodeFileSystem } from "../../../src/core/filesystem";
import { ModuleCache } from "../../../src/core/modules";
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
};

const KEPT = {
  "pinned@2.1.0": "2.1.0",
  "tagged@3.0.0": "3.0.0",
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
