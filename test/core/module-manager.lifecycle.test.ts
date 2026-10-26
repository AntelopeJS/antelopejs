import { internal } from "@antelopejs/interface-core/internal";
import { expect } from "chai";
import assert from "node:assert/strict";
import path from "node:path";
import sinon from "sinon";
import { ModuleManager } from "../../src/core/modules";
import { ModuleState } from "../../src/types";
import { manifestFixture, moduleFixture } from "../helpers/module-fixtures";

describe("ModuleManager", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it("constructs and starts a provided module list", async () => {
    const manager = new ModuleManager();
    const detour = manager["resolverDetour"];
    const attachStub = sinon.stub(detour, "attach");

    const constructStub = sinon.stub().resolves();
    const startStub = sinon.stub();

    const moduleEntry = {
      module: moduleFixture({
        id: "modA",
        version: "1.0.0",
        construct: constructStub,
        start: startStub,
      }),
      config: { config: { flag: true } },
    };

    await manager.constructModules([moduleEntry]);
    expect(attachStub.calledOnce).to.equal(true);
    expect(constructStub.calledWith({ flag: true })).to.equal(true);

    await manager.startModules([moduleEntry]);
    expect(startStub.calledOnce).to.equal(true);
  });

  it("should stop and destroy modules in reverse startup order", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();

    const makeModule = (id: string) =>
      moduleFixture({
        id,
        version: "1.0.0",
        construct: sinon.stub().resolves(),
        start: async () => {
          calls.push(`start:${id}`);
        },
        stop: async () => {
          calls.push(`stop:${id}`);
        },
        destroy: async () => {
          calls.push(`destroy:${id}`);
        },
        state: ModuleState.Active,
        manifest: manifestFixture({
          name: id,
          folder: `/${id}`,
          imports: [],
        }),
      });

    const modA = makeModule("modA");
    const modB = makeModule("modB");
    const modC = makeModule("modC");

    manager["loaded"].set("modA", { module: modA, config: {} });
    manager["loaded"].set("modB", { module: modB, config: {} });
    manager["loaded"].set("modC", { module: modC, config: {} });

    await manager.startAll();
    calls.length = 0;

    await manager.stopAll();

    expect(calls).to.deep.equal(["stop:modC", "stop:modB", "stop:modA"]);
  });

  it("should stop loaded modules even when startup order is empty", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();

    const makeModule = (id: string) =>
      moduleFixture({
        id,
        version: "1.0.0",
        construct: sinon.stub().resolves(),
        start: sinon.stub(),
        stop: async () => {
          calls.push(`stop:${id}`);
        },
        destroy: sinon.stub().resolves(),
        state: ModuleState.Active,
        manifest: manifestFixture({
          name: id,
          folder: `/${id}`,
          imports: [],
        }),
      });

    manager["loaded"].set("modA", {
      module: makeModule("modA"),
      config: {},
    });
    manager["loaded"].set("modB", {
      module: makeModule("modB"),
      config: {},
    });

    await manager.stopAll();

    expect(calls.sort()).to.deep.equal(["stop:modA", "stop:modB"]);
  });
});

describe("ModuleManager", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it("should continue stopping when one module stop fails", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();

    const makeModule = (id: string, shouldFail: boolean) =>
      moduleFixture({
        id,
        version: "1.0.0",
        construct: sinon.stub().resolves(),
        start: sinon.stub(),
        stop: async () => {
          if (shouldFail) {
            throw new Error(`${id} stop failed`);
          }
          calls.push(`stop:${id}`);
        },
        destroy: sinon.stub().resolves(),
        state: ModuleState.Active,
        manifest: manifestFixture({
          name: id,
          folder: `/${id}`,
          imports: [],
        }),
      });

    manager["loaded"].set("modA", {
      module: makeModule("modA", false),
      config: {},
    });
    manager["loaded"].set("modB", {
      module: makeModule("modB", true),
      config: {},
    });
    manager["loaded"].set("modC", {
      module: makeModule("modC", false),
      config: {},
    });

    await manager.startAll();

    let thrown: unknown;
    try {
      await manager.stopAll();
    } catch (error) {
      thrown = error;
    }

    expect(calls).to.deep.equal(["stop:modC", "stop:modA"]);
    expect(thrown).to.be.instanceOf(AggregateError);
    assert.ok(thrown instanceof AggregateError);
    expect(thrown.errors).to.have.length(1);
  });
});

describe("ModuleManager", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it("waits for sibling constructs and aggregates rollback errors", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();
    const detour = manager["resolverDetour"];
    const detach = sinon.stub(detour, "detach");
    sinon.stub(detour, "attach").returns(true);
    Object.defineProperty(manager, "applyInterfaceStubs", {
      value: sinon.stub(),
    });

    let settleA: () => void = () => undefined;
    const moduleA = moduleFixture({
      id: "a",
      version: "1.0.0",
      construct: () =>
        new Promise<void>((resolve) => {
          settleA = () => {
            calls.push("construct:a");
            resolve();
          };
        }),
      destroy: async () => {
        calls.push("destroy:a");
      },
    });
    const moduleB = moduleFixture({
      id: "b",
      version: "1.0.0",
      construct: async () => {
        throw new Error("construct:b");
      },
      destroy: sinon.stub().resolves(),
    });
    const moduleC = moduleFixture({
      id: "c",
      version: "1.0.0",
      construct: async () => {
        calls.push("construct:c");
      },
      destroy: async () => {
        calls.push("destroy:c");
        throw new Error("destroy:c");
      },
    });

    manager["loaded"].set("a", { module: moduleA, config: {} });
    manager["loaded"].set("b", { module: moduleB, config: {} });
    manager["loaded"].set("c", { module: moduleC, config: {} });

    const pending = manager.constructAll();
    await new Promise((resolve) => setImmediate(resolve));
    expect(detach.called).to.equal(false);
    settleA();

    let thrown: unknown;
    try {
      await pending;
    } catch (error) {
      thrown = error;
    }

    expect(calls).to.deep.equal([
      "construct:c",
      "construct:a",
      "destroy:c",
      "destroy:a",
    ]);
    expect(detach.calledOnce).to.equal(true);
    expect(thrown).to.be.instanceOf(AggregateError);
    assert.ok(thrown instanceof AggregateError);
    expect(thrown.errors).to.have.length(2);
  });
});

describe("ModuleManager", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it("destroys every module and clears state after multiple failures", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();
    const makeModule = (id: string, shouldFail: boolean) =>
      moduleFixture({
        id,
        manifest: manifestFixture({
          folder: path.resolve("test", "fixtures", id),
          main: path.resolve("test", "fixtures", id, "index.js"),
        }),
        destroy: async () => {
          calls.push(id);
          if (shouldFail) {
            throw new Error(`destroy:${id}`);
          }
        },
      });

    manager["loaded"].set("a", {
      module: makeModule("a", true),
      config: {},
    });
    manager["loaded"].set("b", {
      module: makeModule("b", true),
      config: {},
    });
    manager["loaded"].set("c", {
      module: makeModule("c", false),
      config: {},
    });

    let thrown: unknown;
    try {
      await manager.destroyAll();
    } catch (error) {
      thrown = error;
    }

    expect(calls).to.deep.equal(["c", "b", "a"]);
    expect(thrown).to.be.instanceOf(AggregateError);
    assert.ok(thrown instanceof AggregateError);
    expect(thrown.errors).to.have.length(2);
    expect(manager.listModules()).to.deep.equal([]);
    expect([...manager.getLoadedModules()]).to.deep.equal([]);
    expect(manager.resolver.modulesById.size).to.equal(0);
  });

  it("privately retains failed cleanup and retries it after clearing state", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();
    const makeModule = (id: string, failOnce: boolean) =>
      moduleFixture({
        id,
        state: ModuleState.Constructed,
        manifest: manifestFixture({
          folder: path.resolve("test", "fixtures", id),
          main: path.resolve("test", "fixtures", id, "index.js"),
        }),
        destroy: sinon.stub().callsFake(async function (this: any) {
          calls.push(id);
          if (failOnce && this.destroy.callCount === 1) {
            throw new Error(`destroy:${id}`);
          }
          this.state = "loaded";
        }),
      });
    const moduleA = makeModule("a", true);
    const moduleB = makeModule("b", true);
    const moduleC = makeModule("c", false);

    for (const module of [moduleA, moduleB, moduleC]) {
      manager["loaded"].set(module.id, { module, config: {} });
      manager.registry.register(module);
    }

    await manager.destroyAll().catch(() => undefined);

    expect(calls).to.deep.equal(["c", "b", "a"]);
    expect(manager.listModules()).to.deep.equal([]);
    expect(manager.getModule("a")).to.equal(undefined);
    expect([...manager.getLoadedModules()]).to.deep.equal([]);

    await manager.destroyAll();

    expect(calls).to.deep.equal(["c", "b", "a", "b", "a"]);
    expect(moduleA.destroy.calledTwice).to.equal(true);
    expect(moduleB.destroy.calledTwice).to.equal(true);
    expect(moduleC.destroy.calledOnce).to.equal(true);
  });
});
