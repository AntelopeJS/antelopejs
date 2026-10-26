import { expect } from "chai";
import assert from "node:assert/strict";
import sinon from "sinon";
import { Module } from "../../../src/core/modules";
import { reloadWatchedModule } from "../../../src/core/runtime";
import { ModuleState } from "../../../src/types";
import {
  loaderFixture,
  managerFixture,
  manifestFixture,
  moduleFixture,
} from "../../helpers/module-fixtures";
import {
  constructManagedModules,
  createReloadHarness,
  startManagedModules,
} from "./module-loading.fixtures";

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
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
      manifestFixture({
        name: "different",
        version: "2.0.0",
        main: __filename,
        folder: "/mods/alpha",
        source: { type: "local", path: "/mods/alpha" },
      }),
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
});

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("recovers on retry after a failed reload", async () => {
    const destroyStub = sinon.stub().resolves();
    const entry = {
      module: moduleFixture({
        id: "alpha",
        state: ModuleState.Active,
        manifest: manifestFixture({
          source: { type: "local", path: "/mods/alpha" },
        }),
        destroy: destroyStub,
      }),
      config: {
        config: {},
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
            manifest: import("../../../src/core/modules").ModuleManifest,
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

    const registryLoadStub = sinon.stub();
    registryLoadStub.onFirstCall().rejects(new Error("tsc compilation failed"));
    registryLoadStub.onSecondCall().resolves([manifest]);

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
    expect(replaceLoadedModuleStub.called).to.equal(false);

    await reloadWatchedModule(manager, "alpha", loaderContext);

    expect(replaceLoadedModuleStub.calledOnce).to.equal(true);
    expect(refreshAssociationsStub.calledOnce).to.equal(true);
    expect(destroyStub.calledOnce).to.equal(true);
  });
});

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("resolves and validates a replacement before destroying the live module", async () => {
    const calls: string[] = [];
    const harness = createReloadHarness();
    harness.loaderContext.registry.load.callsFake(async () => {
      calls.push("load");
      return [
        manifestFixture({
          name: "alpha",
          version: "2.0.0",
          main: __filename,
          folder: "/mods/alpha",
          imports: [],
          source: { type: "local", path: "/mods/alpha" },
        }),
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
    harness.oldModule.start.callsFake(async () => {
      harness.oldModule.state = ModuleState.Active;
    });
    harness.oldModule.destroy.callsFake(async () => {
      harness.oldModule.state = ModuleState.Constructed;
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
});

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
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
    assert.ok(thrown instanceof AggregateError);
    expect(thrown.errors).to.have.length(2);
    expect(harness.entry.module).to.not.equal(harness.oldModule);
  });
});
