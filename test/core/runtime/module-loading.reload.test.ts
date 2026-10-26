import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import assert from "node:assert/strict";
import sinon from "sinon";
import {
  ensureGraphIsValid,
  getWatchDirs,
  reloadWatchedModule,
} from "../../../src/core/runtime/module-loading";
import { ModuleState } from "../../../src/types";
import { recordModuleDiagnostics } from "../../helpers/diagnostics-recorder";
import {
  loaderFixture,
  managerFixture,
  manifestFixture,
  moduleFixture,
} from "../../helpers/module-fixtures";
import {
  constructManagedModules,
  startManagedModules,
} from "./module-loading.fixtures";

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("resolves watch directories for all source variants", () => {
    const multiple = { type: "local", watchDir: ["src", "lib"] } satisfies Pick<
      ModuleSourceLocal,
      "type" | "watchDir"
    >;
    const single = { type: "local", watchDir: "src" } satisfies Pick<
      ModuleSourceLocal,
      "type" | "watchDir"
    >;
    expect(getWatchDirs({ type: "git" })).to.deep.equal([""]);
    expect(getWatchDirs(multiple)).to.deep.equal(["src", "lib"]);
    expect(getWatchDirs(single)).to.deep.equal(["src"]);
    expect(getWatchDirs({ type: "local" })).to.deep.equal([""]);
  });

  it("ensureGraphIsValid passes when all interfaces are resolved", () => {
    const loadedEntry = {
      module: moduleFixture({
        id: "mod",
        manifest: manifestFixture({
          folder: "/tmp",
          implements: [],
          manifest: { dependencies: {} },
        }),
      }),
      config: {},
    };
    const manager = managerFixture({
      getAllManagedModules: () => [loadedEntry],
      getLoadedModules: () => [loadedEntry].values(),
    });
    expect(() => ensureGraphIsValid(manager)).to.not.throw();
  });

  it("treats a static module package as an available dependency", () => {
    const staticEntry = {
      module: moduleFixture({
        id: "antelopejs",
        manifest: manifestFixture({
          name: "antelopejs",
          folder: process.cwd(),
          implements: ["@antelopejs/interface-core"],
          manifest: {
            name: "@antelopejs/core",
            version: "1.4.7",
            dependencies: { "@antelopejs/interface-core": "*" },
          },
        }),
      }),
      config: {},
    };
    const loadedEntry = {
      module: moduleFixture({
        id: "app",
        manifest: manifestFixture({
          folder: process.cwd(),
          implements: [],
          manifest: { dependencies: { "@antelopejs/core": "*" } },
        }),
      }),
      config: {},
    };
    const manager = managerFixture({
      getAllManagedModules: () => [staticEntry, loadedEntry],
      getLoadedModules: () => [loadedEntry].values(),
    });

    expect(() => ensureGraphIsValid(manager)).to.not.throw();
  });

  it("reloads watched modules and ignores unknown ones", async () => {
    const managerWithoutEntry = managerFixture({
      getLoadedModuleEntry: sinon.stub().returns(undefined),
      placeModule: sinon
        .stub()
        .callsFake(
          (
            _id: string,
            manifest: import("../../../src/core/module-manifest").ModuleManifest,
          ) => manifest,
        ),
      discardPlacedModule: sinon.stub(),
      checkReplacement: sinon.stub(),
      unrequireModuleFiles: sinon.stub(),
    });

    const loaderContext = loaderFixture({
      cache: {},
      projectFolder: "/project",
      registry: { load: sinon.stub().resolves([]) },
    });

    await reloadWatchedModule(managerWithoutEntry, "unknown", loaderContext);
    expect(managerWithoutEntry.unrequireModuleFiles.called).to.equal(false);
  });
});

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("reloads watched modules from source when a loader context is provided", async () => {
    const entry = {
      module: moduleFixture({
        id: "alpha",
        state: ModuleState.Active,
        manifest: manifestFixture({
          source: { type: "local", path: "/mods/alpha" },
        }),
        destroy: sinon.stub().resolves(),
      }),
      config: {
        config: { enabled: true },
      },
    };

    const replaceLoadedModuleStub = sinon.stub().returns(entry);
    const refreshAssociationsStub = sinon.stub();
    const manager = managerFixture({
      getLoadedModuleEntry: sinon.stub().returns(entry),
      placeModule: sinon
        .stub()
        .callsFake(
          (
            _id: string,
            manifest: import("../../../src/core/module-manifest").ModuleManifest,
          ) => manifest,
        ),
      discardPlacedModule: sinon.stub(),
      checkReplacement: sinon.stub(),
      unrequireModuleFiles: sinon.stub(),
      replaceLoadedModule: replaceLoadedModuleStub,
      refreshAssociations: refreshAssociationsStub,
      constructModules: sinon.stub().callsFake(constructManagedModules),
      startModules: sinon.stub().callsFake(startManagedModules),
    });

    const manifest = manifestFixture({
      name: "alpha",
      version: "1.0.0",
      main: __filename,
      folder: "/mods/alpha",
      imports: [],
      source: { type: "local", path: "/mods/alpha" },
      reload: sinon.stub().resolves(),
    });
    const registryLoadStub = sinon.stub().resolves([manifest]);
    const loaderContext = loaderFixture({
      cache: {},
      projectFolder: "/project",
      registry: { load: registryLoadStub },
    });

    const recorder = recordModuleDiagnostics("alpha");
    try {
      await reloadWatchedModule(manager, "alpha", loaderContext);
    } finally {
      recorder.restore();
    }

    expect(recorder.trace()).to.deep.equal([
      "load:start",
      "load:end",
      "load:asyncStart",
      "load:asyncEnd",
      "construct:start",
      "construct:end",
      "construct:asyncStart",
      "construct:asyncEnd",
      "start:start",
      "start:end",
      "start:asyncStart",
      "start:asyncEnd",
    ]);
    for (const { payload } of recorder.events) {
      expect(payload.moduleVersion).to.equal("1.0.0");
    }

    expect(entry.module.destroy.calledOnce).to.equal(true);
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
});

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("publishes only a failed load span when a replacement cannot load", async () => {
    const entry = {
      module: moduleFixture({
        id: "alpha",
        state: ModuleState.Active,
        manifest: manifestFixture({
          source: { type: "local", path: "/mods/alpha" },
        }),
        destroy: sinon.stub().resolves(),
      }),
      config: { config: {} },
    };
    const manager = managerFixture({
      getLoadedModuleEntry: sinon.stub().returns(entry),
      placeModule: sinon
        .stub()
        .callsFake(
          (
            _id: string,
            manifest: import("../../../src/core/module-manifest").ModuleManifest,
          ) => manifest,
        ),
      discardPlacedModule: sinon.stub(),
      checkReplacement: sinon.stub(),
      unrequireModuleFiles: sinon.stub(),
      replaceLoadedModule: sinon.stub().returns(entry),
      refreshAssociations: sinon.stub(),
      constructModules: sinon.stub().callsFake(constructManagedModules),
      startModules: sinon.stub().callsFake(startManagedModules),
    });
    const manifest = manifestFixture({
      name: "alpha",
      version: "1.0.0",
      main: "/mods/alpha/no-such-module-entry.js",
      folder: "/mods/alpha",
      imports: [],
      source: { type: "local", path: "/mods/alpha" },
    });
    const loaderContext = loaderFixture({
      cache: {},
      projectFolder: "/project",
      registry: { load: sinon.stub().resolves([manifest]) },
    });

    const recorder = recordModuleDiagnostics("alpha");
    try {
      await reloadWatchedModule(manager, "alpha", loaderContext).catch(
        () => undefined,
      );
    } finally {
      recorder.restore();
    }

    expect(recorder.trace()).to.deep.equal([
      "load:start",
      "load:end",
      "load:error",
      "load:asyncStart",
      "load:asyncEnd",
    ]);
  });
});

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("propagates interface compatibility validation during reload", async () => {
    const entry = {
      module: moduleFixture({
        manifest: manifestFixture({
          source: { type: "local", path: "/mods/alpha" },
        }),
        destroy: sinon.stub().resolves(),
      }),
      config: { config: {} },
    };
    const compatibilityError = new Error(
      "Incompatible interface package resolution",
    );
    const manager = managerFixture({
      getLoadedModuleEntry: sinon.stub().returns(entry),
      placeModule: sinon
        .stub()
        .callsFake(
          (
            _id: string,
            manifest: import("../../../src/core/module-manifest").ModuleManifest,
          ) => manifest,
        ),
      discardPlacedModule: sinon.stub(),
      checkReplacement: sinon.stub(),
      unrequireModuleFiles: sinon.stub(),
      replaceLoadedModule: sinon.stub().returns(entry),
      refreshAssociations: sinon.stub(),
      constructModules: sinon.stub().rejects(compatibilityError),
    });
    const manifest = manifestFixture({
      name: "alpha",
      version: "1.0.0",
      main: __filename,
      folder: "/mods/alpha",
      source: { type: "local", path: "/mods/alpha" },
    });
    const loaderContext = loaderFixture({
      cache: {},
      projectFolder: "/project",
      registry: { load: sinon.stub().resolves([manifest]) },
    });

    let thrown: unknown;
    try {
      await reloadWatchedModule(manager, "alpha", loaderContext);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(AggregateError);
    assert.ok(thrown instanceof AggregateError);
    expect(thrown.errors[0]).to.equal(compatibilityError);
    expect(manager.constructModules.calledOnce).to.equal(true);
  });

  it("propagates error when registry.load fails during reload", async () => {
    const entry = {
      module: moduleFixture({
        id: "alpha",
        state: ModuleState.Active,
        manifest: manifestFixture({
          source: { type: "local", path: "/mods/alpha" },
        }),
        destroy: sinon.stub().resolves(),
      }),
      config: {
        config: {},
      },
    };

    const manager = managerFixture({
      getLoadedModuleEntry: sinon.stub().returns(entry),
      placeModule: sinon
        .stub()
        .callsFake(
          (
            _id: string,
            manifest: import("../../../src/core/module-manifest").ModuleManifest,
          ) => manifest,
        ),
      discardPlacedModule: sinon.stub(),
      checkReplacement: sinon.stub(),
      unrequireModuleFiles: sinon.stub(),
      replaceLoadedModule: sinon.stub(),
      refreshAssociations: sinon.stub(),
    });

    const registryLoadStub = sinon
      .stub()
      .rejects(new Error("tsc compilation failed"));
    const loaderContext = loaderFixture({
      cache: {},
      projectFolder: "/project",
      registry: { load: registryLoadStub },
    });

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
});
