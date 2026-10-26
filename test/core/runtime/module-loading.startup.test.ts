import * as moduleInterfaceBeta from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import assert from "node:assert/strict";
import sinon from "sinon";
import type { ManagedModule } from "../../../src/core/modules";
import { getProcessTasks } from "../../../src/core/output";
import {
  constructAndStartModules,
  destroyModulesAfterFailure,
  registerCoreModuleInterface,
} from "../../../src/core/runtime";
import {
  loaderFixture,
  managerFixture,
  manifestFixture,
  moduleFixture,
} from "../../helpers/module-fixtures";
import { addedModule, graphOf } from "./module-loading.fixtures";

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("constructs and starts modules, and fails gracefully on construct errors", async () => {
    const messageStub = sinon.stub(getProcessTasks().ui, "message");

    const manager = managerFixture({
      constructAll: sinon.stub().resolves(),
      startAll: sinon.stub(),
    });

    await constructAndStartModules(manager);

    expect(messageStub.calledWith("success", "Constructed modules")).to.equal(
      true,
    );
    expect(manager.startAll.calledOnce).to.equal(true);
    expect(messageStub.calledWith("error")).to.equal(false);

    const failingManager = managerFixture({
      constructAll: sinon.stub().rejects(new Error("construct failed")),
      startAll: sinon.stub(),
    });

    let thrown: unknown;
    try {
      await constructAndStartModules(failingManager);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect(
      messageStub.calledWith("error", "Failed to construct modules"),
    ).to.equal(true);
    expect(failingManager.startAll.called).to.equal(false);

    const startupFailure = new Error("start failed");
    const startFailingManager = managerFixture({
      constructAll: sinon.stub().resolves(),
      startAll: sinon.stub().rejects(startupFailure),
    });

    thrown = undefined;
    try {
      await constructAndStartModules(startFailingManager);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.equal(startupFailure);
  });

  it("resolves only after async start hooks settle", async () => {
    let settleStart: () => void = () => undefined;
    let startSettled = false;
    const manager = managerFixture({
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
    });

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
    const manager = managerFixture({
      destroyAll: sinon.stub().rejects(new Error("destroy failed")),
    });

    let thrown: unknown;
    try {
      await destroyModulesAfterFailure(manager, startupFailure);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(AggregateError);
    assert.ok(thrown instanceof AggregateError);
    expect(thrown.errors[0]).to.equal(startupFailure);
    assert.ok(thrown instanceof AggregateError);
    expect(thrown.errors[1]).to.have.property("message", "destroy failed");
    expect(manager.destroyAll.calledOnce).to.equal(true);
  });
});

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("takes the running generation down before LoadModule replaces it", async () => {
    const calls: string[] = [];
    const previous = {
      module: moduleFixture({
        id: "alpha",
        stop: sinon.stub().callsFake(async () => calls.push("stop")),
        destroy: sinon.stub().callsFake(async () => calls.push("destroy")),
      }),
      config: { config: {} },
    };
    const manager = managerFixture({
      getLoadedModuleEntry: sinon
        .stub()
        .callsFake((id: string) => (id === "alpha" ? previous : undefined)),
      unrequireModuleFiles: sinon
        .stub()
        .callsFake(() => calls.push("unrequire")),
      addModules: sinon.stub().callsFake(() => {
        calls.push("add");
        return [addedModule("alpha")];
      }),
      constructModules: sinon.stub().resolves(),
      startModules: sinon.stub().resolves(),
      ...graphOf([]),
    });
    const loaderContext = loaderFixture({
      fs: {},
      cache: {},
      projectFolder: "/project",
      registry: {
        load: sinon.stub().resolves([
          manifestFixture({
            name: "alpha",
            version: "2.0.0",
            folder: "/cache/alpha",
            source: { type: "package", package: "alpha", version: "2.0.0" },
          }),
        ]),
      },
    });
    registerCoreModuleInterface(manager, async () => loaderContext);

    await moduleInterfaceBeta.LoadModule(
      "alpha",
      { source: { type: "package", package: "alpha", version: "2.0.0" } },
      true,
    );

    expect(calls).to.deep.equal(["stop", "destroy", "unrequire", "add"]);
  });

  it("loads a new module without touching any running one", async () => {
    const manager = managerFixture({
      getLoadedModuleEntry: sinon.stub().returns(undefined),
      unrequireModuleFiles: sinon.stub(),
      addModules: sinon.stub().returns([addedModule("beta")]),
      constructModules: sinon.stub().resolves(),
      startModules: sinon.stub().resolves(),
      ...graphOf([]),
    });
    const loaderContext = loaderFixture({
      fs: {},
      cache: {},
      projectFolder: "/project",
      registry: {
        load: sinon.stub().resolves([
          manifestFixture({
            name: "beta",
            version: "1.0.0",
            folder: "/cache/beta",
          }),
        ]),
      },
    });
    registerCoreModuleInterface(manager, async () => loaderContext);

    await moduleInterfaceBeta.LoadModule(
      "beta",
      { source: { type: "package", package: "beta", version: "1.0.0" } },
      false,
    );

    expect(
      (manager.unrequireModuleFiles satisfies sinon.SinonStub).called,
    ).to.equal(false);
  });
});

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("drops the modules LoadModule fails to construct", async () => {
    const destroy = sinon.stub().resolves();
    const manager = managerFixture({
      getLoadedModuleEntry: sinon.stub().returns(undefined),
      unrequireModuleFiles: sinon.stub(),
      addModules: sinon.stub().returns([addedModule("gamma", {}, { destroy })]),
      constructModules: sinon.stub().rejects(new Error("construct failed")),
      startModules: sinon.stub().resolves(),
      discardModules: sinon.stub(),
      ...graphOf([]),
    });
    const loaderContext = loaderFixture({
      fs: {},
      cache: {},
      projectFolder: "/project",
      registry: {
        load: sinon.stub().resolves([
          manifestFixture({
            name: "gamma",
            version: "1.0.0",
            folder: "/cache/gamma",
          }),
        ]),
      },
    });
    registerCoreModuleInterface(manager, async () => loaderContext);

    let thrown: unknown;
    try {
      await moduleInterfaceBeta.LoadModule(
        "gamma",
        { source: { type: "package", package: "gamma", version: "1.0.0" } },
        true,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.have.property("message", "construct failed");
    expect(destroy.calledOnce).to.equal(true);
    expect(
      (manager.discardModules satisfies sinon.SinonStub).calledOnceWith([
        "gamma",
      ]),
    ).to.equal(true);
  });
});

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });
  describe("LoadModule interface checks", () => {
    const REQUIRED_INTERFACE = "@antelopejs/interface-core";

    function loadModuleHarness(
      added: ManagedModule,
      running: ManagedModule[] = [],
    ) {
      const manager = {
        getLoadedModuleEntry: sinon.stub().returns(undefined),
        unrequireModuleFiles: sinon.stub(),
        addModules: sinon.stub().returns([added]),
        constructModules: sinon.stub().resolves(),
        startModules: sinon.stub().resolves(),
        discardModules: sinon.stub(),
        ...graphOf([...running, added]),
      };
      const loaderContext = loaderFixture({
        fs: {},
        cache: {},
        projectFolder: "/project",
        registry: {
          load: sinon.stub().resolves([{ name: added.module.id }]),
        },
      });
      registerCoreModuleInterface(
        managerFixture(manager),
        async () => loaderContext,
      );
      return manager;
    }

    function loadModule(id: string): Promise<string[]> {
      return moduleInterfaceBeta.LoadModule(
        id,
        { source: { type: "package", package: id, version: "1.0.0" } },
        true,
      );
    }

    it("refuses a module whose required interface nothing implements", async () => {
      const destroy = sinon.stub().resolves();
      const manager = loadModuleHarness(
        addedModule(
          "consumer",
          { dependencies: { [REQUIRED_INTERFACE]: "*" } },
          { destroy },
        ),
      );

      let thrown: unknown;
      try {
        await loadModule("consumer");
      } catch (error) {
        thrown = error;
      }

      expect(thrown).to.have.property(
        "message",
        `Unresolved interface dependencies:\n  - consumer requires ${REQUIRED_INTERFACE}\n\nRun 'ajs project modules install' to resolve missing dependencies.`,
      );
      expect(manager.constructModules.called).to.equal(false);
      expect(destroy.calledOnce).to.equal(true);
      expect(manager.discardModules.calledOnceWith(["consumer"])).to.equal(
        true,
      );
    });

    it("loads a module whose interface a running module implements", async () => {
      const provider = addedModule("provider");
      provider.module.manifest.implements.push(REQUIRED_INTERFACE);
      const manager = loadModuleHarness(
        addedModule("consumer", {
          dependencies: { [REQUIRED_INTERFACE]: "*" },
        }),
        [provider],
      );

      expect(await loadModule("consumer")).to.deep.equal(["consumer"]);
      expect(manager.startModules.calledOnce).to.equal(true);
      expect(manager.discardModules.called).to.equal(false);
    });

    it("loads a module that implements the interface it requires", async () => {
      const consumer = addedModule("consumer", {
        dependencies: { [REQUIRED_INTERFACE]: "*" },
      });
      consumer.module.manifest.implements.push(REQUIRED_INTERFACE);
      const manager = loadModuleHarness(consumer);

      expect(await loadModule("consumer")).to.deep.equal(["consumer"]);
      expect(manager.discardModules.called).to.equal(false);
    });

    it("loads a module whose optional interface nothing implements", async () => {
      const manager = loadModuleHarness(
        addedModule("consumer", {
          optionalDependencies: { [REQUIRED_INTERFACE]: "*" },
        }),
      );

      expect(await loadModule("consumer")).to.deep.equal(["consumer"]);
      expect(manager.constructModules.calledOnce).to.equal(true);
      expect(manager.discardModules.called).to.equal(false);
    });
  });
});
