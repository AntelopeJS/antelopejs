import { internal } from "@antelopejs/interface-core/internal";
import { Events } from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import assert from "node:assert/strict";
import path from "node:path";
import sinon from "sinon";
import { Module as CoreModule, ModuleManager } from "../../src/core/modules";
import { manifestFixture, moduleFixture } from "../helpers/module-fixtures";
import nodeModule from "node:module";
import { trackInstanceFiles } from "./module-manager.fixtures";

describe("ModuleManager", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it("re-evaluates a module nested inside an interface package root", () => {
    const manager = new ModuleManager();
    const interfaceRoot = path.resolve("test", "runtime-package");
    const moduleFolder = path.join(interfaceRoot, "playground");
    const pageEntry = path.join(moduleFolder, "dist", "page.js");
    const entryFile = path.join(moduleFolder, "dist", "index.js");

    const cacheEntries = [entryFile, pageEntry];
    const previous: NodeJS.Require["cache"] = {};
    for (const entry of cacheEntries) {
      previous[entry] = require.cache[entry];
      require.cache[entry] = new nodeModule(entry);
    }

    manager["loaded"].set("playground", {
      module: moduleFixture({
        manifest: manifestFixture({ folder: moduleFolder, main: entryFile }),
      }),
      config: {},
    });
    trackInstanceFiles(manager, "@scope/runtime", interfaceRoot, cacheEntries);

    manager.unrequireModuleFiles("playground");

    expect(require.cache[entryFile]).to.equal(undefined);
    expect(require.cache[pageEntry]).to.equal(undefined);

    for (const entry of cacheEntries) {
      if (previous[entry]) {
        require.cache[entry] = previous[entry];
      } else {
        delete require.cache[entry];
      }
    }
  });

  it("keeps the shared graph of a module that ships its own interface", () => {
    const manager = new ModuleManager();
    const moduleFolder = path.resolve("test", "self-hosting");
    const entryFile = path.join(moduleFolder, "dist", "index.js");
    const leafEntry = path.join(moduleFolder, "dist", "leaf.js");

    const cacheEntries = [entryFile, leafEntry];
    const previous: NodeJS.Require["cache"] = {};
    for (const entry of cacheEntries) {
      previous[entry] = require.cache[entry];
      require.cache[entry] = new nodeModule(entry);
    }

    manager["loaded"].set("self", {
      module: moduleFixture({
        manifest: manifestFixture({ folder: moduleFolder, main: entryFile }),
      }),
      config: {},
    });
    trackInstanceFiles(manager, "@scope/self", moduleFolder, cacheEntries);

    manager.unrequireModuleFiles("self");

    expect(require.cache[entryFile], "module entry is re-evaluated").to.equal(
      undefined,
    );
    expect(
      require.cache[leafEntry],
      "shared contract keeps its identity",
    ).to.not.equal(undefined);

    for (const entry of cacheEntries) {
      if (previous[entry]) {
        require.cache[entry] = previous[entry];
      } else {
        delete require.cache[entry];
      }
    }
  });

  it("releases the resolver lease when partial construction fails", async () => {
    const originalResolver = nodeModule._resolveFilename;
    const manager = new ModuleManager();
    const moduleEntry = {
      module: moduleFixture({
        id: "failing",
        version: "1.0.0",
        construct: sinon.stub().rejects(new Error("construct failed")),
      }),
      config: {},
    };

    let constructionError: unknown;
    try {
      await manager.constructModules([moduleEntry]);
    } catch (error) {
      constructionError = error;
    }

    expect(constructionError).to.be.instanceOf(Error);
    expect(nodeModule._resolveFilename).to.equal(originalResolver);
  });
});

describe("ModuleManager", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it("keeps manager-owned global state isolated during rebuild and destroy", async () => {
    const first = new ModuleManager();
    const second = new ModuleManager();
    const firstManifest = manifestFixture({
      name: "duplicate",
      version: "1.0.0",
      main: "/first/index.js",
      folder: "/first",
      manifest: { name: "duplicate", version: "1.0.0" },
      source: { type: "local", path: "/first" },
    });
    const secondManifest = manifestFixture({
      name: firstManifest.name,
      version: firstManifest.version,
      manifest: firstManifest.manifest,
      main: "/second/index.js",
      folder: "/second",
      source: { type: "local", path: "/second" },
    });

    first.addModules([{ manifest: firstManifest }]);
    second.addModules([{ manifest: secondManifest }]);
    first.refreshAssociations();

    expect(
      internal.moduleByFolder.map((entry) => entry.dir).sort(),
    ).to.deep.equal(["/first", "/second"]);

    await first.destroyAll();
    expect(internal.moduleByFolder.map((entry) => entry.dir)).to.deep.equal([
      "/second",
    ]);
    expect(internal.interfaceConnections.duplicate).to.not.equal(undefined);

    await second.destroyAll();
    expect(internal.moduleByFolder).to.have.length(0);
    expect(internal.interfaceConnections.duplicate).to.equal(undefined);
  });

  it("does not leak leases or global state across repeated destruction", async () => {
    const originalResolver = nodeModule._resolveFilename;
    const manager = new ModuleManager();

    await manager.constructAll();
    await manager.destroyAll();
    await manager.destroyAll();
    await manager.constructAll();
    await manager.destroyAll();

    expect(nodeModule._resolveFilename).to.equal(originalResolver);
    expect(internal.moduleByFolder).to.have.length(0);
    expect(internal.interfaceConnections).to.deep.equal({});
  });
});

describe("ModuleManager lifecycle signals", () => {
  let calls: string[];

  const onStarted = () => calls.push("started");

  const onStopping = () => calls.push("stopping");

  beforeEach(() => {
    calls = [];
    Events.ModulesStarted.register(onStarted);
    Events.ModulesStopping.register(onStopping);
  });

  afterEach(() => {
    Events.ModulesStarted.unregister(onStarted);
    Events.ModulesStopping.unregister(onStopping);
    sinon.restore();
  });

  async function addConstructedModule(
    manager: ModuleManager,
    id: string,
    start: (() => void) | (() => Promise<void>),
  ): Promise<CoreModule> {
    const module = new CoreModule(
      manifestFixture({ name: id, version: "1.0.0", main: `/${id}/index.js` }),
      sinon.stub().resolves({
        start,
        stop: () => calls.push(`stop:${id}`),
      }),
    );
    await module.construct({});
    manager["loaded"].set(id, { module, config: {} });
    return module;
  }

  it("announces started once every module started, and stopping once before the first stop", async () => {
    const manager = new ModuleManager();
    let releaseSlow: () => void = () => undefined;
    await addConstructedModule(manager, "fast", () => calls.push("start:fast"));
    await addConstructedModule(manager, "slow", async () => {
      calls.push("start:slow");
      await new Promise<void>((resolve) => {
        releaseSlow = resolve;
      });
      calls.push("started:slow");
    });

    const starting = manager.startAll();
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).to.not.include("started");
    releaseSlow();
    await starting;
    await manager.stopAll();

    expect(calls).to.deep.equal([
      "start:fast",
      "start:slow",
      "started:slow",
      "started",
      "stopping",
      "stop:slow",
      "stop:fast",
    ]);
  });

  it("announces stopping only when the project stops, not when one module stops, restarts or is destroyed", async () => {
    const manager = new ModuleManager();
    const reloaded = await addConstructedModule(manager, "reloaded", () =>
      calls.push("start:reloaded"),
    );
    const removed = await addConstructedModule(manager, "removed", () =>
      calls.push("start:removed"),
    );

    await manager.startAll();
    await reloaded.stop();
    await manager.startModules([manager.getModuleEntry("reloaded")!]);
    await removed.destroy();
    expect(calls).to.not.include("stopping");

    await manager.stopAll();
    expect(calls.filter((call) => call === "stopping")).to.have.length(1);
    expect(calls.at(-2)).to.equal("stopping");
  });

  it("does not announce started when a module fails to start", async () => {
    const manager = new ModuleManager();
    await addConstructedModule(manager, "ok", () => undefined);
    await addConstructedModule(manager, "broken", () => {
      throw new Error("broken start");
    });

    let thrown: unknown;
    try {
      await manager.startModules([...manager["loaded"].values()]);
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof AggregateError);
    expect(thrown.errors[0].message).to.equal("broken start");
    expect(calls).to.not.include("started");
  });
});

describe("ModuleManager lifecycle signals", () => {
  let calls: string[];

  const onStarted = () => calls.push("started");

  const onStopping = () => calls.push("stopping");

  beforeEach(() => {
    calls = [];
    Events.ModulesStarted.register(onStarted);
    Events.ModulesStopping.register(onStopping);
  });

  afterEach(() => {
    Events.ModulesStarted.unregister(onStarted);
    Events.ModulesStopping.unregister(onStopping);
    sinon.restore();
  });

  async function addConstructedModule(
    manager: ModuleManager,
    id: string,
    start: (() => void) | (() => Promise<void>),
  ): Promise<CoreModule> {
    const module = new CoreModule(
      manifestFixture({ name: id, version: "1.0.0", main: `/${id}/index.js` }),
      sinon.stub().resolves({
        start,
        stop: () => calls.push(`stop:${id}`),
      }),
    );
    await module.construct({});
    manager["loaded"].set(id, { module, config: {} });
    return module;
  }

  it("fails a start that does not settle in time, naming the late module", async () => {
    const clock = sinon.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });
    const manager = new ModuleManager();
    await addConstructedModule(manager, "punctual", () => undefined);
    await addConstructedModule(
      manager,
      "late",
      () => new Promise<void>(() => undefined),
    );

    const starting = manager
      .startModules([...manager["loaded"].values()])
      .catch((error: unknown) => error);
    await clock.tickAsync(120_000);
    const error = await starting;

    expect(error).to.be.instanceOf(AggregateError);
    assert.ok(error instanceof AggregateError);
    expect(error.errors).to.have.lengthOf(1);
    expect(error.errors[0]).to.have.property(
      "message",
      "Module 'late' did not start within 120 s",
    );
    expect(calls).to.not.include("started");
  });
});
