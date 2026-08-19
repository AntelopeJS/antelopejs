import * as moduleInterfaceBeta from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import sinon from "sinon";
import { terminalDisplay } from "../../../src/core/cli/terminal-display";
import { Module } from "../../../src/core/module";
import type {
  ManagedModule,
  ModuleManager,
} from "../../../src/core/module-manager";
import {
  constructAndStartModules,
  destroyModulesAfterFailure,
  ensureGraphIsValid,
  getWatchDirs,
  registerCoreModuleInterface,
  reloadWatchedModule,
} from "../../../src/core/runtime/module-loading";

interface ReloadHarness {
  oldModule: any;
  entry: any;
  manager: any;
  loaderContext: any;
}

function createReloadHarness(): ReloadHarness {
  const oldModule = {
    id: "alpha",
    state: "active",
    manifest: { source: { type: "local", path: "/mods/alpha" } },
    destroy: sinon.stub(),
  };
  oldModule.destroy.callsFake(async () => {
    oldModule.state = "loaded";
  });
  const entry: any = { module: oldModule, config: { config: {} } };
  const manifest = {
    name: "alpha",
    version: "2.0.0",
    main: __filename,
    folder: "/mods/alpha",
    imports: [],
    source: { type: "local", path: "/mods/alpha" },
  } as any;
  const manager = {
    getLoadedModuleEntry: sinon.stub().returns(entry),
    unrequireModuleFiles: sinon.stub(),
    replaceLoadedModule: sinon
      .stub()
      .callsFake((_id: string, replacement: Module) => {
        entry.module = replacement;
        return entry;
      }),
    refreshAssociations: sinon.stub(),
    constructModules: sinon.stub().callsFake(constructManagedModules),
  };
  const loaderContext = {
    cache: {},
    projectFolder: "/project",
    registry: { load: sinon.stub().resolves([manifest]) },
  } as any;
  return { oldModule, entry, manager, loaderContext };
}

async function constructManagedModules(
  entries: ManagedModule[],
): Promise<void> {
  await Promise.all(
    entries.map(({ module, config }) => module.construct(config.config)),
  );
}

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("resolves watch directories for all source variants", () => {
    expect(getWatchDirs({ type: "git" } as any)).to.deep.equal([""]);
    expect(
      getWatchDirs({ type: "local", watchDir: ["src", "lib"] } as any),
    ).to.deep.equal(["src", "lib"]);
    expect(
      getWatchDirs({ type: "local", watchDir: "src" } as any),
    ).to.deep.equal(["src"]);
    expect(getWatchDirs({ type: "local" } as any)).to.deep.equal([""]);
  });

  it("ensureGraphIsValid passes when all interfaces are resolved", () => {
    const loadedEntry = {
      module: {
        id: "mod",
        manifest: {
          folder: "/tmp",
          implements: [],
          manifest: { dependencies: {} },
        },
      },
      config: {},
    };
    const manager = {
      getAllManagedModules: () => [loadedEntry],
      getLoadedModules: () => [loadedEntry].values(),
    } as any;
    expect(() => ensureGraphIsValid(manager)).to.not.throw();
  });

  it("reloads watched modules and ignores unknown ones", async () => {
    const managerWithoutEntry = {
      getLoadedModuleEntry: sinon.stub().returns(undefined),
      unrequireModuleFiles: sinon.stub(),
    } as any;

    const loaderContext = {
      cache: {},
      projectFolder: "/project",
      registry: { load: sinon.stub().resolves([]) },
    } as any;

    await reloadWatchedModule(managerWithoutEntry, "unknown", loaderContext);
    expect(managerWithoutEntry.unrequireModuleFiles.called).to.equal(false);
  });

  it("reloads watched modules from source when a loader context is provided", async () => {
    const entry = {
      module: {
        id: "alpha",
        state: "active",
        manifest: { source: { type: "local", path: "/mods/alpha" } },
        destroy: sinon.stub().resolves(),
      },
      config: {
        config: { enabled: true },
      },
    };

    const replaceLoadedModuleStub = sinon.stub().returns(entry);
    const refreshAssociationsStub = sinon.stub();
    const manager = {
      getLoadedModuleEntry: sinon.stub().returns(entry),
      unrequireModuleFiles: sinon.stub(),
      replaceLoadedModule: replaceLoadedModuleStub,
      refreshAssociations: refreshAssociationsStub,
      constructModules: sinon.stub().callsFake(constructManagedModules),
    } as any;

    const manifest = {
      name: "alpha",
      version: "1.0.0",
      main: __filename,
      folder: "/mods/alpha",
      imports: [],
      source: { type: "local", path: "/mods/alpha" },
      reload: sinon.stub().resolves(),
    } as any;
    const registryLoadStub = sinon.stub().resolves([manifest]);
    const loaderContext = {
      cache: {},
      projectFolder: "/project",
      registry: { load: registryLoadStub },
    } as any;

    await reloadWatchedModule(manager, "alpha", loaderContext);

    expect((entry.module as any).destroy.calledOnce).to.equal(true);
    expect(manager.unrequireModuleFiles.calledWith("alpha")).to.equal(true);
    const expectedSource = { type: "local", path: "/mods/alpha", id: "alpha" };
    expect(
      registryLoadStub.calledWith(
        "/project",
        loaderContext.cache,
        expectedSource,
      ),
    ).to.equal(true);
    expect(replaceLoadedModuleStub.calledOnce).to.equal(true);
    expect(refreshAssociationsStub.calledOnce).to.equal(true);
    expect(manager.constructModules.calledOnce).to.equal(true);
  });

  it("propagates interface compatibility validation during reload", async () => {
    const entry = {
      module: {
        manifest: { source: { type: "local", path: "/mods/alpha" } },
        destroy: sinon.stub().resolves(),
      },
      config: { config: {} },
    };
    const compatibilityError = new Error(
      "Incompatible interface package resolution",
    );
    const manager = {
      getLoadedModuleEntry: sinon.stub().returns(entry),
      unrequireModuleFiles: sinon.stub(),
      replaceLoadedModule: sinon.stub().returns(entry),
      refreshAssociations: sinon.stub(),
      constructModules: sinon.stub().rejects(compatibilityError),
    } as any;
    const manifest = {
      name: "alpha",
      version: "1.0.0",
      main: __filename,
      folder: "/mods/alpha",
      source: { type: "local", path: "/mods/alpha" },
    } as any;
    const loaderContext = {
      cache: {},
      projectFolder: "/project",
      registry: { load: sinon.stub().resolves([manifest]) },
    } as any;

    let thrown: unknown;
    try {
      await reloadWatchedModule(manager, "alpha", loaderContext);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(AggregateError);
    expect((thrown as AggregateError).errors[0]).to.equal(compatibilityError);
    expect(manager.constructModules.calledOnce).to.equal(true);
  });

  it("propagates error when registry.load fails during reload", async () => {
    const entry = {
      module: {
        id: "alpha",
        state: "active",
        manifest: { source: { type: "local", path: "/mods/alpha" } },
        destroy: sinon.stub().resolves(),
      },
      config: {
        config: {},
      },
    };

    const manager = {
      getLoadedModuleEntry: sinon.stub().returns(entry),
      unrequireModuleFiles: sinon.stub(),
      replaceLoadedModule: sinon.stub(),
      refreshAssociations: sinon.stub(),
    } as any;

    const registryLoadStub = sinon
      .stub()
      .rejects(new Error("tsc compilation failed"));
    const loaderContext = {
      cache: {},
      projectFolder: "/project",
      registry: { load: registryLoadStub },
    } as any;

    let thrown: unknown;
    try {
      await reloadWatchedModule(manager, "alpha", loaderContext);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect(entry.module.destroy.called).to.equal(false);
    expect(manager.replaceLoadedModule.called).to.equal(false);
  });

  it("preserves the live module when reload returns no manifest", async () => {
    const harness = createReloadHarness();
    harness.loaderContext.registry.load.resolves([]);

    let thrown: unknown;
    try {
      await reloadWatchedModule(
        harness.manager,
        "alpha",
        harness.loaderContext,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.have.property(
      "message",
      "Failed to reload module alpha: no manifest returned",
    );
    expect(harness.oldModule.destroy.called).to.equal(false);
    expect(harness.manager.replaceLoadedModule.called).to.equal(false);
    expect(harness.entry.module).to.equal(harness.oldModule);
  });

  it("preserves the live module when the replacement id is invalid", async () => {
    const harness = createReloadHarness();
    harness.loaderContext.registry.load.resolves([
      {
        name: "different",
        version: "2.0.0",
        main: __filename,
        folder: "/mods/alpha",
        source: { type: "local", path: "/mods/alpha" },
      },
    ]);

    let thrown: unknown;
    try {
      await reloadWatchedModule(
        harness.manager,
        "alpha",
        harness.loaderContext,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.have.property(
      "message",
      "Reloaded module id mismatch: expected alpha, got different",
    );
    expect(harness.oldModule.destroy.called).to.equal(false);
    expect(harness.manager.replaceLoadedModule.called).to.equal(false);
    expect(harness.entry.module).to.equal(harness.oldModule);
  });

  it("recovers on retry after a failed reload", async () => {
    const destroyStub = sinon.stub().resolves();
    const entry = {
      module: {
        id: "alpha",
        state: "active",
        manifest: { source: { type: "local", path: "/mods/alpha" } },
        destroy: destroyStub,
      },
      config: {
        config: {},
      },
    };

    const replaceLoadedModuleStub = sinon.stub().returns(entry);
    const refreshAssociationsStub = sinon.stub();
    const manager = {
      getLoadedModuleEntry: sinon.stub().returns(entry),
      unrequireModuleFiles: sinon.stub(),
      replaceLoadedModule: replaceLoadedModuleStub,
      refreshAssociations: refreshAssociationsStub,
      constructModules: sinon.stub().callsFake(constructManagedModules),
    } as any;

    const manifest = {
      name: "alpha",
      version: "1.0.0",
      main: __filename,
      folder: "/mods/alpha",
      imports: [],
      source: { type: "local", path: "/mods/alpha" },
      reload: sinon.stub().resolves(),
    } as any;

    const registryLoadStub = sinon.stub();
    registryLoadStub.onFirstCall().rejects(new Error("tsc compilation failed"));
    registryLoadStub.onSecondCall().resolves([manifest]);

    const loaderContext = {
      cache: {},
      projectFolder: "/project",
      registry: { load: registryLoadStub },
    } as any;

    let thrown: unknown;
    try {
      await reloadWatchedModule(manager, "alpha", loaderContext);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).to.be.instanceOf(Error);
    expect(replaceLoadedModuleStub.called).to.equal(false);

    await reloadWatchedModule(manager, "alpha", loaderContext);

    expect(replaceLoadedModuleStub.calledOnce).to.equal(true);
    expect(refreshAssociationsStub.calledOnce).to.equal(true);
    expect(destroyStub.calledOnce).to.equal(true);
  });

  it("resolves and validates a replacement before destroying the live module", async () => {
    const calls: string[] = [];
    const harness = createReloadHarness();
    harness.loaderContext.registry.load.callsFake(async () => {
      calls.push("load");
      return [
        {
          name: "alpha",
          version: "2.0.0",
          main: __filename,
          folder: "/mods/alpha",
          imports: [],
          source: { type: "local", path: "/mods/alpha" },
        },
      ];
    });
    harness.oldModule.destroy.callsFake(async () => {
      calls.push("destroy-old");
    });
    harness.manager.replaceLoadedModule.callsFake(
      (_id: string, replacement: Module) => {
        calls.push("replace");
        harness.entry.module = replacement;
        return harness.entry;
      },
    );
    harness.manager.refreshAssociations.callsFake(() => {
      calls.push("associate");
    });
    const construct = sinon
      .stub(Module.prototype, "construct")
      .callsFake(async function (this: Module) {
        calls.push("construct");
      });
    const start = sinon.stub(Module.prototype, "start").callsFake(async () => {
      calls.push("start");
    });

    await reloadWatchedModule(harness.manager, "alpha", harness.loaderContext);

    expect(calls).to.deep.equal([
      "load",
      "destroy-old",
      "replace",
      "associate",
      "construct",
      "start",
    ]);
    expect(construct.calledOnce).to.equal(true);
    expect(start.calledOnce).to.equal(true);
  });

  it("keeps the old module installed when its destroy fails", async () => {
    const harness = createReloadHarness();
    harness.oldModule.start = sinon.stub().callsFake(async () => {
      harness.oldModule.state = "active";
    });
    harness.oldModule.destroy.callsFake(async () => {
      harness.oldModule.state = "constructed";
      throw new Error("destroy-old");
    });

    let thrown: unknown;
    try {
      await reloadWatchedModule(
        harness.manager,
        "alpha",
        harness.loaderContext,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(AggregateError);
    expect(harness.entry.module).to.equal(harness.oldModule);
    expect(harness.manager.replaceLoadedModule.called).to.equal(false);
    expect(harness.manager.unrequireModuleFiles.called).to.equal(false);
    expect(harness.oldModule.start.calledOnce).to.equal(true);
    expect(harness.oldModule.state).to.equal("active");
  });

  it("leaves a stopped safe state when replacement installation fails", async () => {
    const harness = createReloadHarness();
    harness.manager.replaceLoadedModule.returns(undefined);

    let thrown: unknown;
    try {
      await reloadWatchedModule(
        harness.manager,
        "alpha",
        harness.loaderContext,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(AggregateError);
    expect(harness.oldModule.destroy.calledOnce).to.equal(true);
    expect(harness.entry.module).to.equal(harness.oldModule);
    expect(harness.oldModule.state).to.equal("loaded");
  });

  it("cleans the replacement when association fails", async () => {
    const harness = createReloadHarness();
    harness.manager.refreshAssociations.throws(new Error("associate"));
    const destroy = sinon.stub(Module.prototype, "destroy").resolves();

    let thrown: unknown;
    try {
      await reloadWatchedModule(
        harness.manager,
        "alpha",
        harness.loaderContext,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(AggregateError);
    expect(harness.entry.module).to.not.equal(harness.oldModule);
    expect(destroy.calledOnce).to.equal(true);
  });

  it("cleans the replacement when construct fails", async () => {
    const harness = createReloadHarness();
    sinon.stub(Module.prototype, "construct").rejects(new Error("construct"));
    const destroy = sinon.stub(Module.prototype, "destroy").resolves();

    let thrown: unknown;
    try {
      await reloadWatchedModule(
        harness.manager,
        "alpha",
        harness.loaderContext,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(AggregateError);
    expect(destroy.calledOnce).to.equal(true);
  });

  it("cleans the replacement when start fails", async () => {
    const harness = createReloadHarness();
    sinon.stub(Module.prototype, "construct").resolves();
    sinon.stub(Module.prototype, "start").rejects(new Error("start"));
    const destroy = sinon.stub(Module.prototype, "destroy").resolves();

    let thrown: unknown;
    try {
      await reloadWatchedModule(
        harness.manager,
        "alpha",
        harness.loaderContext,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(AggregateError);
    expect(destroy.calledOnce).to.equal(true);
  });

  it("aggregates activation and replacement cleanup failures", async () => {
    const harness = createReloadHarness();
    sinon.stub(Module.prototype, "construct").rejects(new Error("construct"));
    sinon.stub(Module.prototype, "destroy").rejects(new Error("cleanup"));

    let thrown: unknown;
    try {
      await reloadWatchedModule(
        harness.manager,
        "alpha",
        harness.loaderContext,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(AggregateError);
    expect((thrown as AggregateError).errors).to.have.length(2);
    expect(harness.entry.module).to.not.equal(harness.oldModule);
  });

  it("constructs and starts modules, and fails gracefully on construct errors", async () => {
    sinon.stub(terminalDisplay, "startSpinner").resolves();
    const stopSpinnerStub = sinon
      .stub(terminalDisplay, "stopSpinner")
      .resolves();
    const failSpinnerStub = sinon
      .stub(terminalDisplay, "failSpinner")
      .resolves();

    const manager = {
      constructAll: sinon.stub().resolves(),
      startAll: sinon.stub(),
    } as any;

    await constructAndStartModules(manager);

    expect(stopSpinnerStub.calledWith("Done loading")).to.equal(true);
    expect(manager.startAll.calledOnce).to.equal(true);
    expect(failSpinnerStub.called).to.equal(false);

    const failingManager = {
      constructAll: sinon.stub().rejects(new Error("construct failed")),
      startAll: sinon.stub(),
    } as any;

    let thrown: unknown;
    try {
      await constructAndStartModules(failingManager);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect(failSpinnerStub.calledWith("Failed to construct modules")).to.equal(
      true,
    );
    expect(failingManager.startAll.called).to.equal(false);

    const startupFailure = new Error("start failed");
    const startFailingManager = {
      constructAll: sinon.stub().resolves(),
      startAll: sinon.stub().rejects(startupFailure),
    } as any;

    thrown = undefined;
    try {
      await constructAndStartModules(startFailingManager);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.equal(startupFailure);
  });

  it("resolves only after async start hooks settle", async () => {
    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();

    let settleStart: () => void = () => undefined;
    let startSettled = false;
    const manager = {
      constructAll: sinon.stub().resolves(),
      startAll: sinon.stub().callsFake(
        () =>
          new Promise<void>((resolve) => {
            settleStart = () => {
              startSettled = true;
              resolve();
            };
          }),
      ),
    } as any;

    let resolved = false;
    const pending = constructAndStartModules(manager).then(() => {
      resolved = true;
    });

    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(manager.startAll.calledOnce).to.equal(true);
    expect(resolved).to.equal(false);

    settleStart();
    await pending;
    expect(startSettled).to.equal(true);
    expect(resolved).to.equal(true);
  });

  it("aggregates startup and cleanup errors", async () => {
    const startupFailure = new Error("start failed");
    const manager = {
      destroyAll: sinon.stub().rejects(new Error("destroy failed")),
    } as any;

    let thrown: unknown;
    try {
      await destroyModulesAfterFailure(manager, startupFailure);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(AggregateError);
    expect((thrown as AggregateError).errors[0]).to.equal(startupFailure);
    expect((thrown as AggregateError).errors[1]).to.have.property(
      "message",
      "destroy failed",
    );
    expect(manager.destroyAll.calledOnce).to.equal(true);
  });

  it("handles module interface operations and error branches", async () => {
    const listModulesStub = sinon.stub().returns(["alpha"]);
    const getModuleEntryStub = sinon.stub();
    const getLoadedModuleEntryStub = sinon.stub();
    const addModulesStub = sinon
      .stub()
      .returns([{ module: { id: "alpha" }, config: {} }]);
    const constructModulesStub = sinon.stub().resolves();
    const startModulesStub = sinon.stub();
    const getModuleStub = sinon.stub();
    const replaceLoadedModuleStub = sinon.stub();
    const refreshAssociationsStub = sinon.stub();
    const unrequireModuleFilesStub = sinon.stub();
    const manager = {
      listModules: listModulesStub,
      getModuleEntry: getModuleEntryStub,
      getLoadedModuleEntry: getLoadedModuleEntryStub,
      addModules: addModulesStub,
      constructModules: constructModulesStub,
      startModules: startModulesStub,
      getModule: getModuleStub,
      replaceLoadedModule: replaceLoadedModuleStub,
      refreshAssociations: refreshAssociationsStub,
      unrequireModuleFiles: unrequireModuleFilesStub,
    } as unknown as ModuleManager;

    const registryLoadStub = sinon.stub();
    const loaderContext = {
      fs: {} as any,
      cache: {} as any,
      projectFolder: "/project",
      registry: {
        load: registryLoadStub,
      },
    } as any;

    registerCoreModuleInterface(manager, async () => loaderContext);

    manager.getModuleEntry = sinon.stub().returns(undefined) as any;
    let infoError: unknown;
    try {
      await moduleInterfaceBeta.GetModuleInfo("missing");
    } catch (error) {
      infoError = error;
    }
    expect(infoError).to.be.instanceOf(Error);

    manager.getModule = sinon.stub().returns(undefined) as any;
    await moduleInterfaceBeta.StartModule("unknown");
    await moduleInterfaceBeta.StopModule("unknown");
    await moduleInterfaceBeta.DestroyModule("unknown");

    manager.getLoadedModuleEntry = sinon.stub().returns(undefined) as any;
    await moduleInterfaceBeta.ReloadModule("unknown");

    manager.getModuleEntry = sinon.stub().returns({
      module: {
        state: "unexpected",
        manifest: { source: { type: "local" }, folder: "/mods/alpha" },
      },
      config: {
        config: {},
      },
    }) as any;

    const info = await moduleInterfaceBeta.GetModuleInfo("alpha");
    expect(info.status).to.equal("unknown");
    expect(info.importOverrides).to.deep.equal({});
    expect(info.disabledExports).to.deep.equal([]);

    const manifest = {
      name: "alpha",
      version: "1.0.0",
      main: "/mods/alpha/index.js",
      folder: "/mods/alpha",
      imports: [],
      source: { type: "local", path: "/mods/alpha" },
      reload: sinon.stub().resolves(),
    } as any;

    registryLoadStub.resolves([manifest]);
    await moduleInterfaceBeta.LoadModule(
      "alpha",
      { source: { type: "local", path: "/mods/alpha" } },
      false,
    );
    expect(startModulesStub.called).to.equal(false);

    const liveDestroy = sinon.stub().resolves();
    const liveEntry = {
      module: {
        id: "alpha",
        state: "active",
        manifest: { source: { type: "local", path: "/mods/alpha" } },
        destroy: liveDestroy,
      },
      config: {
        config: {},
      },
    };
    manager.getLoadedModuleEntry = sinon.stub().returns(liveEntry) as any;

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
        ...manifest,
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
