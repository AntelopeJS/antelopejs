import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import * as moduleInterfaceBeta from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import assert from "node:assert/strict";
import sinon from "sinon";
import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../../src/core/downloaders";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { ModuleCache, ModuleLockStore } from "../../../src/core/modules";
import { CliError, getProcessTasks } from "../../../src/core/output";
import {
  buildModuleConfigs,
  registerCoreModuleInterface,
} from "../../../src/core/runtime";
import { ModuleState } from "../../../src/types";
import { isObject } from "../../../src/utils";
import { fakeNpm } from "../../helpers/fake-npm";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";
import {
  loadedConfigFixture,
  loaderFixture,
  manifestFixture,
  moduleFixture,
} from "../../helpers/module-fixtures";
import { createInterfaceOperationsFixture } from "./module-loading.fixtures";

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("handles module interface operations and error branches", async () => {
    const { manager, loaderContext, startModulesStub, registryLoadStub } =
      createInterfaceOperationsFixture();

    registerCoreModuleInterface(manager, async () => loaderContext);

    manager.getModuleEntry.returns(undefined);
    let infoError: unknown;
    try {
      await moduleInterfaceBeta.GetModuleInfo("missing");
    } catch (error) {
      infoError = error;
    }
    expect(infoError).to.be.instanceOf(Error);

    manager.getModule.returns(undefined);
    await moduleInterfaceBeta.StartModule("unknown");
    await moduleInterfaceBeta.StopModule("unknown");
    await moduleInterfaceBeta.DestroyModule("unknown");

    manager.getLoadedModuleEntry.returns(undefined);
    await moduleInterfaceBeta.ReloadModule("unknown");

    const unrecognizedStateModule = moduleFixture({
      manifest: manifestFixture({
        source: { type: "local" },
        folder: "/mods/alpha",
      }),
    });
    Object.defineProperty(unrecognizedStateModule, "state", {
      value: "unexpected",
    });
    manager.getModuleEntry.returns({
      module: unrecognizedStateModule,
      config: {
        config: {},
      },
    });

    const info = await moduleInterfaceBeta.GetModuleInfo("alpha");
    expect(info.status).to.equal("unknown");
    expect(info.importOverrides).to.deep.equal({});
    expect(info.disabledExports).to.deep.equal([]);

    const manifest = manifestFixture({
      name: "alpha",
      version: "1.0.0",
      main: "/mods/alpha/index.js",
      folder: "/mods/alpha",
      imports: [],
      source: { type: "local", path: "/mods/alpha" },
      reload: sinon.stub().resolves(),
    });

    registryLoadStub.resolves([manifest]);
    await moduleInterfaceBeta.LoadModule(
      "alpha",
      { source: { type: "local", path: "/mods/alpha" } },
      false,
    );
    expect(startModulesStub.called).to.equal(false);

    const liveDestroy = sinon.stub().resolves();
    const liveEntry = {
      module: moduleFixture({
        id: "alpha",
        state: ModuleState.Active,
        manifest: manifestFixture({
          source: { type: "local", path: "/mods/alpha" },
        }),
        destroy: liveDestroy,
      }),
      config: {
        config: {},
      },
    };
    manager.getLoadedModuleEntry.returns(liveEntry);

    registryLoadStub.resolves([]);
    let reloadNoManifestError: unknown;
    try {
      await moduleInterfaceBeta.ReloadModule("alpha");
    } catch (error) {
      reloadNoManifestError = error;
    }
    expect(reloadNoManifestError).to.be.instanceOf(Error);
    expect(liveDestroy.called).to.equal(false);

    registryLoadStub.resolves([
      {
        version: manifest.version,
        main: manifest.main,
        folder: manifest.folder,
        imports: manifest.imports,
        source: manifest.source,
        reload: manifest.reload,
        name: "different-id",
      },
    ]);

    let reloadMismatchError: unknown;
    try {
      await moduleInterfaceBeta.ReloadModule("alpha");
    } catch (error) {
      reloadMismatchError = error;
    }
    expect(reloadMismatchError).to.be.instanceOf(Error);
    expect(liveDestroy.called).to.equal(false);
  });
});

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("lets every module finish loading before failing with the only failure", async () => {
    const messageStub = sinon.stub(getProcessTasks().ui, "message");
    const installFailure = new Error("install failed for alpha");
    let isBetaSettled = false;
    const load = sinon.stub();
    load.onFirstCall().rejects(installFailure);
    load.onSecondCall().callsFake(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      isBetaSettled = true;
      return [];
    });
    const config = loadedConfigFixture({
      modules: {
        alpha: { source: { type: "local", path: "/mods/alpha" } },
        beta: { source: { type: "local", path: "/mods/beta" } },
      },
    });
    const context = loaderFixture({
      cache: {},
      projectFolder: "/project",
      registry: { load },
    });

    let caught: unknown;
    try {
      await buildModuleConfigs(config, context);
    } catch (err) {
      caught = err;
    }

    expect(caught).to.equal(installFailure);
    expect(isBetaSettled).to.equal(true);
    expect(messageStub.called).to.equal(false);
    expect(getProcessTasks().hasRunningTasks()).to.equal(false);
  });

  it("lists several failures once each and sums them up in one error", async () => {
    const messageStub = sinon.stub(getProcessTasks().ui, "message");
    const alphaFailure = new CliError({
      title: "Install failed for alpha",
      reason: "'npx tsc' exited with code 2.",
      fixes: ["Fix the install command"],
    });
    const betaFailure = new CliError({
      title: "Install failed for beta",
      fixes: ["Fix the install command"],
    });
    const load = sinon.stub();
    load.onFirstCall().rejects(alphaFailure);
    load.onSecondCall().rejects(betaFailure);
    load.onThirdCall().resolves([]);
    const config = loadedConfigFixture({
      modules: {
        alpha: { source: { type: "local", path: "/mods/alpha" } },
        beta: { source: { type: "local", path: "/mods/beta" } },
        gamma: { source: { type: "local", path: "/mods/gamma" } },
      },
    });
    const context = loaderFixture({
      cache: {},
      projectFolder: "/project",
      registry: { load },
    });

    const caught = await buildModuleConfigs(config, context).catch(
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return err;
      },
    );

    expect(caught).to.be.instanceOf(CliError);
    assert.ok(caught instanceof CliError);
    expect(caught.problem).to.deep.equal({
      title: "Could not load 2 of 3 modules",
      fixes: ["Fix the install command"],
    });
    assert.ok(caught instanceof CliError);
    expect(caught.cause).to.equal(alphaFailure);
    expect(messageStub.args).to.deep.equal([
      [
        "error",
        "Install failed for alpha",
        { detail: "'npx tsc' exited with code 2." },
      ],
      ["error", "Install failed for beta", { detail: undefined }],
    ]);
  });

  it("reports the loaded modules once they are all loaded", async () => {
    const messageStub = sinon.stub(getProcessTasks().ui, "message");
    const config = loadedConfigFixture({
      modules: { alpha: { source: { type: "local", path: "/mods/alpha" } } },
    });
    const context = loaderFixture({
      cache: {},
      projectFolder: "/project",
      registry: { load: sinon.stub().resolves([]) },
    });

    await buildModuleConfigs(config, context);

    expect(messageStub.calledOnceWith("success", "Loaded 1 module")).to.equal(
      true,
    );
  });
});

describe("runtime module-loading: frozen module locks", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("fails the load of an optional npm module that has no lock instead of skipping it", async () => {
    sinon.stub(getProcessTasks().ui, "message");
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, {
      fs,
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
      lock: { store: new ModuleLockStore("/project", fs), mode: "frozen" },
    });
    const config = loadedConfigFixture({
      modules: {
        extra: {
          source: { type: "package", package: "extra", version: "1.0.0" },
          optional: true,
        },
      },
    });

    const caught = await buildModuleConfigs(config, {
      fs: new NodeFileSystem(),
      cache,
      registry,
      projectFolder: "/project",
    }).catch((err: unknown) => err);

    assert.ok(caught instanceof CliError);
    expect(caught.message).to.equal("No module lock for extra@1.0.0");
  });
});

describe("runtime module-loading: recorded module locks", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("reports the module locks a load recorded as one line", async () => {
    const messageStub = sinon.stub(getProcessTasks().ui, "message");
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    const locks = new ModuleLockStore("/project", fs);
    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, {
      fs,
      ...fakeNpm(fs, () => "lock"),
      lock: { store: locks, mode: "record" },
    });
    const config = loadedConfigFixture({
      modules: {
        alpha: {
          source: { type: "package", package: "alpha", version: "1.0.0" },
        },
        beta: {
          source: { type: "package", package: "beta", version: "2.0.0" },
        },
      },
      moduleLocks: undefined,
    });

    await buildModuleConfigs(config, {
      fs: new NodeFileSystem(),
      cache,
      registry,
      projectFolder: "/project",
      locks,
    });

    const reported = messageStub.args
      .map(([, text]) => text)
      .filter((text) => text.includes("antelope-lock"));
    expect(reported).to.have.length(1);
    expect(reported[0]).to.include("Recorded 2 module locks");
  });
});

describe("runtime module-loading: modules sharing a package", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("starts two modules that need the same package from an empty cache", async () => {
    sinon.stub(getProcessTasks().ui, "message");
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    const npm = fakeNpm(fs, () => "lock");
    const commands: string[] = [];
    const installing = new Set<string>();
    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, {
      fs,
      ...npm,
      exec: async (command, options) => {
        commands.push(command);
        const cwd = options?.cwd ?? "";
        if (command.startsWith("npm pack")) {
          return npm.exec(command, options);
        }
        if (installing.has(cwd)) {
          throw new Error(`${cwd} was replaced during its install`);
        }
        installing.add(cwd);
        await new Promise((resolve) => setTimeout(resolve, 5));
        installing.delete(cwd);
        return npm.exec(command, options);
      },
    });
    const config = loadedConfigFixture({
      modules: {
        first: {
          source: { type: "package", package: "shared", version: "1.0.0" },
        },
        second: {
          source: { type: "package", package: "shared", version: "1.0.0" },
        },
      },
      moduleLocks: undefined,
    });

    const entries = await buildModuleConfigs(config, {
      fs: new NodeFileSystem(),
      cache,
      registry,
      projectFolder: "/project",
      locks: new ModuleLockStore("/project", fs),
    });

    expect(entries.map(({ manifest }) => manifest.name)).to.have.members([
      "first",
      "second",
    ]);
    expect(commands.filter((c) => c.startsWith("npm pack"))).to.deep.equal([
      'npm pack "shared@1.0.0"',
    ]);
  });
});

describe("runtime module-loading: modules pinning two versions of a package", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("starts each module on the version it pins", async () => {
    sinon.stub(getProcessTasks().ui, "message");
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, { fs, ...fakeNpm(fs, () => "lock") });
    const pinned = (version: string) => ({
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version,
      } satisfies ModuleSourcePackage,
    });
    const config = loadedConfigFixture({
      modules: { old: pinned("1.7.0"), current: pinned("1.8.0") },
      moduleLocks: undefined,
    });

    const entries = await buildModuleConfigs(config, {
      fs: new NodeFileSystem(),
      cache,
      registry,
      projectFolder: "/project",
      locks: new ModuleLockStore("/project", fs),
    });

    const installed = await Promise.all(
      entries.map(async ({ manifest }) => {
        const text = await fs.readFileString(`${manifest.folder}/package.json`);
        const parsed: unknown = JSON.parse(text);
        return [manifest.name, isObject(parsed) ? parsed.version : undefined];
      }),
    );
    expect(Object.fromEntries(installed)).to.deep.equal({
      old: "1.7.0",
      current: "1.8.0",
    });
  });
});
