import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import { maxSatisfying } from "semver";

import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../../src/core/downloaders";
import {
  ModuleCache,
  ModuleLockStore,
  type ModuleLockMode,
} from "../../../src/core/modules";
import { CliError } from "../../../src/core/output";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

const PKG = "@scope/mod";
const CACHE_LOCK = `/cache/${PKG}/pnpm-lock.yaml`;
const RESOLVED_LOCK = "resolved: from the registry today";
const RECORDED_LOCK = "resolved: recorded yesterday";

interface Harness {
  fs: InMemoryFileSystem;
  cache: ModuleCache;
  store: ModuleLockStore;
  calls: string[];
  lockAtInstall: Array<string | undefined>;
  load(version: string, extra?: Partial<ModuleSourcePackage>): Promise<string>;
}

const MANIFEST = (version: string) =>
  JSON.stringify({
    name: PKG,
    version,
    packageManager: "pnpm@10.6.5",
    dependencies: { dep: "^1.0.0" },
  });

async function createHarness(
  mode: ModuleLockMode | undefined,
  registryVersions: string[] = ["1.0.0"],
): Promise<Harness> {
  const fs = new InMemoryFileSystem();
  const cache = new ModuleCache("/cache", fs);
  await cache.load();
  const store = new ModuleLockStore("/project", fs);
  const calls: string[] = [];
  const lockAtInstall: Array<string | undefined> = [];
  let packed = "";
  const exec = async (command: string) => {
    calls.push(command);
    if (command.startsWith("npm view")) {
      return { stdout: JSON.stringify(registryVersions), stderr: "", code: 0 };
    }
    if (command.startsWith("npm pack")) {
      const spec = command.slice(command.lastIndexOf("@") + 1, -1);
      packed = maxSatisfying(registryVersions, spec) ?? spec;
      return { stdout: "mod.tgz", stderr: "", code: 0 };
    }
    const folder = `/cache/${PKG}`;
    lockAtInstall.push(
      (await fs.exists(CACHE_LOCK))
        ? await fs.readFileString(CACHE_LOCK)
        : undefined,
    );
    if (!(await fs.exists(CACHE_LOCK))) {
      await fs.writeFile(CACHE_LOCK, RESOLVED_LOCK);
    }
    await fs.mkdir(`${folder}/node_modules`, { recursive: true });
    return { stdout: "", stderr: "", code: 0 };
  };
  const registry = new DownloaderRegistry();
  registerPackageDownloader(registry, {
    fs,
    exec,
    getTemp: async () => "/tmp/pack",
    extract: async () => {
      await fs.writeFile("/tmp/pack/package/package.json", MANIFEST(packed));
    },
    getInstallCommand: async () => "pnpm install --prod",
    lock: mode ? { store, mode } : undefined,
  });
  return {
    fs,
    cache,
    store,
    calls,
    lockAtInstall,
    async load(version, extra = {}) {
      const [manifest] = await registry.load("/project", cache, {
        type: "package",
        package: PKG,
        version,
        id: PKG,
        ...extra,
      });
      return manifest.manifest.version;
    },
  };
}

async function warmCache(harness: Harness, version: string, lock: string) {
  await harness.fs.writeFile(`/cache/${PKG}/package.json`, MANIFEST(version));
  await harness.fs.mkdir(`/cache/${PKG}/node_modules`, { recursive: true });
  await harness.fs.writeFile(CACHE_LOCK, lock);
  await harness.cache.commitVersion(PKG, version);
}

function recorded(version: string, content: string) {
  return { package: PKG, version, lockfile: "pnpm-lock.yaml", content };
}

describe("PackageDownloader module locks", () => {
  it("records the lockfile the package manager wrote when the project has no lock for the module", async () => {
    const harness = await createHarness("record");

    await harness.load("1.0.0");

    expect(harness.lockAtInstall).to.deep.equal([undefined]);
    expect(
      await harness.store.read({ package: PKG, version: "1.0.0" }),
    ).to.deep.equal(recorded("1.0.0", RESOLVED_LOCK));
  });

  it("puts the recorded lockfile in the cache folder before the install command runs", async () => {
    const harness = await createHarness("record");
    await harness.store.write(recorded("1.0.0", RECORDED_LOCK));

    await harness.load("1.0.0");

    expect(harness.lockAtInstall).to.deep.equal([RECORDED_LOCK]);
    expect(await harness.fs.readFileString(CACHE_LOCK)).to.equal(RECORDED_LOCK);
  });

  it("reinstalls a cached module installed from another lockfile than the recorded one", async () => {
    const harness = await createHarness("record");
    await warmCache(harness, "1.0.0", RESOLVED_LOCK);
    await harness.store.write(recorded("1.0.0", RECORDED_LOCK));

    await harness.load("1.0.0");

    expect(harness.calls).to.include(`npm pack "${PKG}@1.0.0"`);
    expect(harness.lockAtInstall).to.deep.equal([RECORDED_LOCK]);
  });

  it("reuses a cached module installed from the recorded lockfile without running anything", async () => {
    const harness = await createHarness("record");
    await warmCache(harness, "1.0.0", RECORDED_LOCK);
    await harness.store.write(recorded("1.0.0", RECORDED_LOCK));

    await harness.load("1.0.0");

    expect(harness.calls).to.deep.equal([]);
  });

  it("records the lockfile of a warm cache when the project has none yet, without reinstalling", async () => {
    const harness = await createHarness("record");
    await warmCache(harness, "1.0.0", RESOLVED_LOCK);

    await harness.load("1.0.0");

    expect(harness.calls).to.deep.equal([]);
    expect(
      await harness.store.read({ package: PKG, version: "1.0.0" }),
    ).to.deep.equal(recorded("1.0.0", RESOLVED_LOCK));
  });

  it("keeps a locked range on its recorded version without asking the registry", async () => {
    const harness = await createHarness("record", ["1.0.0", "1.1.0"]);
    await harness.store.write(recorded("1.0.0", RECORDED_LOCK));

    const version = await harness.load("^1.0.0");

    expect(version).to.equal("1.0.0");
    expect(harness.calls.some((call) => call.startsWith("npm view"))).to.equal(
      false,
    );
  });

  it("fails in frozen mode when the project has no lock, before downloading anything", async () => {
    const harness = await createHarness("frozen");

    const failure = await harness.load("1.0.0").then(
      () => undefined,
      (error) => error,
    );

    expect(failure).to.be.instanceOf(CliError);
    expect(failure.message).to.equal(`No module lock for ${PKG}@1.0.0`);
    expect(harness.calls).to.deep.equal([]);
  });

  it("fails in frozen mode even when a warm cache holds the module", async () => {
    const harness = await createHarness("frozen");
    await warmCache(harness, "1.0.0", RESOLVED_LOCK);

    const failure = await harness.load("1.0.0").then(
      () => undefined,
      (error) => error,
    );

    expect(failure).to.be.instanceOf(CliError);
    expect(await harness.store.list()).to.deep.equal([]);
  });

  it("installs from the record in frozen mode and leaves the record untouched", async () => {
    const harness = await createHarness("frozen");
    await harness.store.write(recorded("1.0.0", RECORDED_LOCK));

    await harness.load("1.0.0");

    expect(harness.lockAtInstall).to.deep.equal([RECORDED_LOCK]);
    expect(
      await harness.store.read({ package: PKG, version: "1.0.0" }),
    ).to.deep.equal(recorded("1.0.0", RECORDED_LOCK));
  });

  it("resolves again in refresh mode: ignores the warm cache and the record, and records the new lockfile", async () => {
    const harness = await createHarness("refresh", ["1.0.0", "1.1.0"]);
    await warmCache(harness, "1.0.0", RECORDED_LOCK);
    await harness.store.write(recorded("1.0.0", RECORDED_LOCK));

    const version = await harness.load("^1.0.0");

    expect(version).to.equal("1.1.0");
    expect(harness.lockAtInstall).to.deep.equal([undefined]);
    expect(
      await harness.store.read({ package: PKG, version: "1.1.0" }),
    ).to.deep.equal(recorded("1.1.0", RESOLVED_LOCK));
  });

  it("replays the record of the downloaded version when the source ignores the cache", async () => {
    const harness = await createHarness("record");
    await harness.store.write(recorded("1.0.0", RECORDED_LOCK));

    await harness.load("1.0.0", { ignoreCache: true });

    expect(harness.lockAtInstall).to.deep.equal([RECORDED_LOCK]);
  });
});

describe("PackageDownloader module locks: sources", () => {
  it("keeps a locked range on its recorded version when the source ignores the cache", async () => {
    const harness = await createHarness("record", ["1.0.0", "1.1.0"]);
    await harness.store.write(recorded("1.0.0", RECORDED_LOCK));

    const version = await harness.load("^1.0.0", { ignoreCache: true });

    expect(version).to.equal("1.0.0");
    expect(harness.lockAtInstall).to.deep.equal([RECORDED_LOCK]);
    expect(await harness.store.versions(PKG)).to.deep.equal(["1.0.0"]);
  });

  it("installs a locked range from its record in frozen mode when the source ignores the cache", async () => {
    const harness = await createHarness("frozen", ["1.0.0", "1.1.0"]);
    await harness.store.write(recorded("1.0.0", RECORDED_LOCK));

    const version = await harness.load("^1.0.0", { ignoreCache: true });

    expect(version).to.equal("1.0.0");
    expect(harness.lockAtInstall).to.deep.equal([RECORDED_LOCK]);
  });

  it("installs a v-prefixed exact version from the record of its clean version in frozen mode", async () => {
    const harness = await createHarness("frozen");
    await harness.store.write(recorded("1.0.0", RECORDED_LOCK));

    const version = await harness.load("v1.0.0");

    expect(version).to.equal("1.0.0");
    expect(harness.lockAtInstall).to.deep.equal([RECORDED_LOCK]);
  });

  it("installs from the record in replay mode, and installs without recording when the project has none", async () => {
    const harness = await createHarness("replay");
    await harness.store.write(recorded("1.0.0", RECORDED_LOCK));

    await harness.load("1.0.0");
    await harness.load("2.0.0");

    expect(harness.lockAtInstall).to.deep.equal([RECORDED_LOCK, undefined]);
    expect(await harness.store.versions(PKG)).to.deep.equal(["1.0.0"]);
  });

  it("writes no lock folder when the downloader has no lock policy", async () => {
    const harness = await createHarness(undefined);

    await harness.load("1.0.0");

    expect(await harness.fs.exists("/project/antelope-lock")).to.equal(false);
  });
});
