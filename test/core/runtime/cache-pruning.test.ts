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
    ranged: { source: { type: "package", package: "ranged", version: "^2.0.0" } },
  },
  environments: {
    production: {
      modules: {
        repo: { source: { type: "git", remote: "https://example.com/repo.git" } },
        tagged: { source: { type: "package", package: "tagged", version: "next" } },
      },
    },
  },
};
`;

const TEST_CONFIG = `export default {
  name: "pruning-test",
  modules: {
    provider: { source: { type: "package", package: "provider", version: "1.0.0" } },
  },
};
`;

const OPEN_CONFIG = `export default (ctx: { env: string }) => ({
  name: "pruning",
  modules: ctx.env === "production"
    ? { db: { source: { type: "package", package: "real-db", version: "^1.0.0" } } }
    : { db: { source: { type: "package", package: "mock-db", version: "^1.0.0" } } },
});
`;

const STALE = {
  ranged: "2.0.0",
  "ranged@1.0.0": "1.0.0",
  "dropped@1.0.0": "1.0.0",
  "provider@0.9.0": "0.9.0",
};

const KEPT = {
  "ranged@2.0.0": "2.0.0",
  "ranged@2.1.0": "2.1.0",
  "tagged@1.0.0": "1.0.0",
  "tagged@2.0.0-beta.1": "2.0.0-beta.1",
  https___example_com_repo_git: "git:main:abc",
  "provider@1.0.0": "1.0.0",
  "locked@3.0.0": "3.0.0",
};

const nodeFs = new NodeFileSystem();

async function seedCache(manifest: Record<string, string>) {
  const fs = new InMemoryFileSystem();
  await fs.writeFile("/cache/manifest.json", JSON.stringify(manifest));
  for (const entry of Object.keys(manifest)) {
    await fs.writeFile(`/cache/${entry}/package.json`, "{}");
  }
  return fs;
}

async function openCache(fs: InMemoryFileSystem): Promise<ModuleCache> {
  const cache = new ModuleCache("/cache", fs);
  await cache.load();
  return cache;
}

async function manifestOf(fs: InMemoryFileSystem) {
  const text = await fs.readFileString("/cache/manifest.json");
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

let project: string;

async function writeProject(file: string, content: string): Promise<void> {
  await fsPromises.mkdir(path.dirname(path.join(project, file)), {
    recursive: true,
  });
  await fsPromises.writeFile(path.join(project, file), content);
}

function setUpProject(): void {
  beforeEach(async () => {
    project = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ajs-prune-"));
    await writeProject("antelope.config.ts", CONFIG);
    await writeProject("antelope.test.ts", TEST_CONFIG);
    await writeProject(
      "package.json",
      JSON.stringify({ name: "p", antelopeJs: { test: "antelope.test.ts" } }),
    );
    await fsPromises.mkdir(
      path.join(project, "antelope-lock", "locked@3.0.0"),
      {
        recursive: true,
      },
    );
  });

  afterEach(async () => {
    await fsPromises.rm(project, { recursive: true, force: true });
  });
}

describe("pruneModuleCache", () => {
  setUpProject();

  it("keeps what an environment, the test configuration or a lock accepts and removes the rest", async () => {
    const fs = await seedCache({ ...STALE, ...KEPT });

    await pruneModuleCache(await openCache(fs), project, nodeFs);

    expect(await manifestOf(fs)).to.deep.equal(KEPT);
    expect(await fs.exists("/cache/ranged@1.0.0")).to.equal(false);
    expect(await fs.exists("/cache/provider@1.0.0/package.json")).to.equal(
      true,
    );
  });

  it("keeps what build.json points at once the configuration drops it", async () => {
    const folder = "/cache/@scope/built@1.0.0";
    const source: ModuleSourcePackage = {
      type: "package",
      package: "@scope/built",
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
          built: {
            folder,
            source,
            name: "@scope/built",
            main: `${folder}/index.js`,
            manifest: { name: "@scope/built", version: "1.0.0" },
            baseUrl: folder,
            paths: [],
          },
        },
      }),
      nodeFs,
    );
    const fs = await seedCache({ "@scope/built@1.0.0": "1.0.0" });

    await pruneModuleCache(await openCache(fs), project, nodeFs);

    expect(await manifestOf(fs)).to.deep.equal({
      "@scope/built@1.0.0": "1.0.0",
    });
  });

  it("only removes old-layout entries when the configuration accepts environments it does not list", async () => {
    await writeProject("antelope.config.ts", OPEN_CONFIG);
    const fs = await seedCache({
      "real-db": "1.0.0",
      "real-db@1.0.0": "1.0.0",
      "mock-db@0.1.0": "0.1.0",
    });

    await pruneModuleCache(await openCache(fs), project, nodeFs);

    expect(await manifestOf(fs)).to.deep.equal({
      "real-db@1.0.0": "1.0.0",
      "mock-db@0.1.0": "0.1.0",
    });
  });

  it("leaves the cache as it is when the configuration cannot be read", async () => {
    await fsPromises.rm(path.join(project, "antelope.config.ts"));
    const fs = await seedCache(STALE);

    await pruneModuleCache(await openCache(fs), project, nodeFs);

    expect(await manifestOf(fs)).to.deep.equal(STALE);
  });
});

describe("pruneModuleCache with two runs sharing one cache", () => {
  setUpProject();

  it("a dev never removes what a concurrent test run resolved", async () => {
    const fs = await seedCache({
      "ranged@2.0.0": "2.0.0",
      "dropped@1.0.0": "1.0.0",
    });
    const dev = await openCache(fs);
    const testRun = await openCache(fs);
    await dev.getFolder("ranged@2.0.0", true, true);
    await testRun.transfer(await stage(fs, "provider"), "provider@1.0.0");
    await testRun.commitVersion("provider@1.0.0", "1.0.0");

    await pruneModuleCache(dev, project, nodeFs);

    expect(await manifestOf(fs)).to.deep.equal({
      "ranged@2.0.0": "2.0.0",
      "provider@1.0.0": "1.0.0",
    });
    expect(await fs.exists("/cache/provider@1.0.0/package.json")).to.equal(
      true,
    );
  });

  it("a dev never removes what a concurrent build resolved before writing build.json", async () => {
    const fs = await seedCache({
      "ranged@2.0.0": "2.0.0",
      https___example_com_repo_git: "git:main:abc",
      "tagged@1.0.0": "1.0.0",
    });
    const dev = await openCache(fs);
    const build = await openCache(fs);
    await dev.getFolder("ranged@2.0.0", true, true);
    await build.getFolder("https___example_com_repo_git", true, true);
    await build.getFolder("tagged@1.0.0", true, true);

    await pruneModuleCache(dev, project, nodeFs);
    await pruneModuleCache(build, project, nodeFs);

    expect(await manifestOf(fs)).to.deep.equal({
      "ranged@2.0.0": "2.0.0",
      https___example_com_repo_git: "git:main:abc",
      "tagged@1.0.0": "1.0.0",
    });
  });

  it("a dev never removes an older version a run that started earlier resolved in the same range", async () => {
    const fs = await seedCache({ "ranged@2.0.0": "2.0.0" });
    const earlier = await openCache(fs);
    const later = await openCache(fs);
    await earlier.getFolder("ranged@2.0.0", true, true);
    await later.transfer(await stage(fs, "ranged"), "ranged@2.1.0");
    await later.commitVersion("ranged@2.1.0", "2.1.0");

    await pruneModuleCache(later, project, nodeFs);

    expect(await fs.exists("/cache/ranged@2.0.0/package.json")).to.equal(true);
  });
});

async function stage(fs: InMemoryFileSystem, name: string): Promise<string> {
  await fs.writeFile(`/staging/${name}/package.json`, "{}");
  return `/staging/${name}`;
}
