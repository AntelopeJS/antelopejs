import { expect } from "chai";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  launch,
  launchFromBuild,
  type ModuleManager,
  TestModule,
} from "../../src";
import { hasEntryFolder, leaseNames, seedCache } from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir, writeJson } from "../helpers/temp";

const REPO_ROOT = path.resolve(__dirname, "../..");
const PACKAGE_ENTRY = path.join(REPO_ROOT, "src/index.ts");
const RUN_B_KEY = "__ajsCacheLeaseRunB";
const PACKAGE_VARIABLE = "AJS_CACHE_LEASE_PACKAGE";
const CHILD_TIMEOUT_MS = 60_000;
const OFFLINE_NPM = {
  npm_config_registry: "http://127.0.0.1:9/",
  npm_config_fetch_retries: "0",
};

interface TestGlobals {
  [RUN_B_KEY]?: () => Promise<void>;
}
const testGlobals: typeof globalThis & TestGlobals = globalThis;

/** The TypeScript of a package source for `<name>@1.0.0`, the version the cache holds. */
function packageSource(name: string): string {
  return `{ type: "package", package: ${name}, version: "1.0.0" }`;
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

/** Writes `antelope.config.ts` with `config`, TypeScript text, as its default export. */
function writeProject(folder: string, config: string): string {
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, "antelope.config.ts"),
    `export default ${config};\n`,
  );
  return folder;
}

/** A configuration that loads `<name>@1.0.0` from the cache at `cache`. */
function loadingPackage(cache: string, name: string): string {
  return `{ name: ${quoted(name)}, cacheFolder: ${quoted(cache)}, modules: { picked: { source: ${packageSource(quoted(name))} } } }`;
}

async function stop(manager: ModuleManager): Promise<void> {
  await manager.stopAll();
  await manager.destroyAll();
}

/** Launches B, which loads `b@1.0.0` and prunes, after seeding `b` and an unleased `stale` in the cache. */
async function runB(cache: string, project: string, env?: string) {
  seedCache(cache, ["b@1.0.0", "stale@1.0.0"]);
  await stop(await launch(project, env));
}

/** Runs `build(project, env)` in a child process that exits once it is built. */
function buildInChild(project: string, env: string): Promise<void> {
  const script = `require(${quoted(PACKAGE_ENTRY)}).build(${quoted(project)}, ${quoted(env)}).then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["-r", "ts-node/register", "-e", script],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, ...OFFLINE_NPM, TS_NODE_TRANSPILE_ONLY: "true" },
        timeout: CHILD_TIMEOUT_MS,
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(output)),
    );
  });
}

/** The cache folders the modules of `manager` load from. */
function loadedFolders(manager: ModuleManager): string[] {
  return [...manager.getLoadedModules()].map(({ module }) =>
    path.resolve(module.manifest.folder),
  );
}

interface SharedCache {
  root: string;
  cache: string;
}

/**
 * Gives each test a fresh cache holding `a@1.0.0` under a temporary root,
 * with the npm registry unreachable so that no run downloads.
 */
function useSharedCache(): SharedCache {
  const shared: SharedCache = { root: "", cache: "" };
  const saved = Object.fromEntries(
    [...Object.keys(OFFLINE_NPM), PACKAGE_VARIABLE].map((key) => [
      key,
      process.env[key],
    ]),
  );

  beforeEach(() => {
    Object.assign(process.env, OFFLINE_NPM);
    shared.root = makeTempDir("ajs-cache-two-runs-");
    shared.cache = path.join(shared.root, "shared-cache");
    seedCache(shared.cache, ["a@1.0.0"]);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    delete testGlobals[RUN_B_KEY];
    cleanupTempDir(shared.root);
  });

  return shared;
}

function expectAKeptAndStaleRemoved(cache: string): void {
  expect(hasEntryFolder(cache, "a@1.0.0")).to.equal(true);
  expect(hasEntryFolder(cache, "b@1.0.0")).to.equal(true);
  expect(hasEntryFolder(cache, "stale@1.0.0")).to.equal(false);
}

/**
 * Writes a module whose test setup adds `a@1.0.0` from `cache` and whose one
 * test calls the run B hook, and returns the path of that test file.
 */
function writeTestedModule(folder: string, cache: string): string {
  writeJson(path.join(folder, "package.json"), {
    name: "module-a",
    version: "1.0.0",
    main: "index.js",
    antelopeJs: { test: "antelope.test.config.ts" },
  });
  writeFileSync(path.join(folder, "index.js"), "module.exports = {};\n");
  writeFileSync(
    path.join(folder, "antelope.test.config.ts"),
    `export default { name: "module-a", cacheFolder: ${quoted(cache)}, modules: { self: { source: { type: "local", path: "." } } }, test: { setup: async () => ({ modules: { a: { source: ${packageSource(quoted("a"))} } } }) } };\n`,
  );
  const fixtureTest = path.join(folder, "fixture.test.js");
  writeFileSync(
    fixtureTest,
    `describe("module a", () => { it("runs B while A is loaded", () => globalThis.${RUN_B_KEY}()); });\n`,
  );
  return fixtureTest;
}

describe("A live run and another run pruning the module cache they share", function () {
  this.timeout(CHILD_TIMEOUT_MS);
  const shared = useSharedCache();

  it("keeps what a run of another project with the same cacheFolder loaded", async () => {
    const { root, cache } = shared;
    const projectA = writeProject(
      path.join(root, "a"),
      loadingPackage(cache, "a"),
    );
    const projectB = writeProject(
      path.join(root, "b"),
      loadingPackage(cache, "b"),
    );

    const runA = await launch(projectA);
    try {
      await runB(cache, projectB);
      expectAKeptAndStaleRemoved(cache);
    } finally {
      await stop(runA);
    }
  });

  it("keeps what a module test run added in its setup, B pruning from inside its test", async () => {
    const { root, cache } = shared;
    const fixtureTest = writeTestedModule(path.join(root, "module-a"), cache);
    const projectB = writeProject(
      path.join(root, "b"),
      loadingPackage(cache, "b"),
    );
    let ranB = false;
    testGlobals[RUN_B_KEY] = async () => {
      await runB(cache, projectB);
      ranB = true;
    };

    const failures = await TestModule(
      path.dirname(fixtureTest),
      [fixtureTest],
      30_000,
    );

    expect(failures).to.equal(0);
    expect(ranB).to.equal(true);
    expectAKeptAndStaleRemoved(cache);
  });

  it("keeps what a run that picked its package from the environment loaded", async () => {
    const { root, cache } = shared;
    const project = writeProject(
      path.join(root, "project"),
      `{ name: "picked", cacheFolder: ${quoted(cache)}, modules: { picked: { source: ${packageSource(quoted("b"))} } }, envOverrides: { ${PACKAGE_VARIABLE}: "modules.picked.source.package" } }`,
    );

    process.env[PACKAGE_VARIABLE] = "a";
    const runA = await launch(project);
    delete process.env[PACKAGE_VARIABLE];
    try {
      expect(loadedFolders(runA)).to.include(path.join(cache, "a@1.0.0"));
      await runB(cache, project);
      expectAKeptAndStaleRemoved(cache);
    } finally {
      await stop(runA);
    }
  });

  it("keeps what a run in an environment the environments map does not list loaded", async () => {
    const { root, cache } = shared;
    const project = writeProject(
      path.join(root, "project"),
      `({ env }: { env: string }) => ({ name: "branching", cacheFolder: ${quoted(cache)}, modules: { picked: { source: ${packageSource('env === "staging" ? "a" : "b"')} } }, environments: { production: {} } })`,
    );

    const runA = await launch(project, "staging");
    try {
      expect(loadedFolders(runA)).to.include(path.join(cache, "a@1.0.0"));
      await runB(cache, project, "default");
      expectAKeptAndStaleRemoved(cache);
    } finally {
      await stop(runA);
    }
  });
});

describe("A finished build and a run pruning the module cache they share", function () {
  this.timeout(CHILD_TIMEOUT_MS * 2);
  const shared = useSharedCache();

  it("keeps what the project's build.json points at, so the build still starts", async () => {
    const { root, cache } = shared;
    const project = writeProject(
      path.join(root, "project"),
      `({ env }: { env: string }) => ({ name: "built", cacheFolder: ${quoted(cache)}, modules: { picked: { source: ${packageSource('env === "production" ? "a" : "b"')} } } })`,
    );
    await buildInChild(project, "production");
    expect(leaseNames(cache)).to.deep.equal([]);

    await runB(cache, project, "default");

    expectAKeptAndStaleRemoved(cache);
    const started = await launchFromBuild(project, "production");
    try {
      expect(loadedFolders(started)).to.deep.equal([
        path.join(cache, "a@1.0.0"),
      ]);
    } finally {
      await stop(started);
    }
  });

  it("keeps what another project's pinned build points at, so that build still starts", async () => {
    const { root, cache } = shared;
    const built = writeProject(
      path.join(root, "p1"),
      loadingPackage(cache, "a"),
    );
    const projectB = writeProject(
      path.join(root, "p2"),
      loadingPackage(cache, "b"),
    );
    await buildInChild(built, "default");
    expect(leaseNames(cache)).to.deep.equal([]);

    await runB(cache, projectB);

    expectAKeptAndStaleRemoved(cache);
    const started = await launchFromBuild(built);
    try {
      expect(loadedFolders(started)).to.deep.equal([
        path.join(cache, "a@1.0.0"),
      ]);
    } finally {
      await stop(started);
    }
  });
});
