import { internal } from "@antelopejs/interface-core/internal";
import { expect } from "chai";
import sinon from "sinon";

import { Module as CoreModule, ModuleManager } from "../../src/core/modules";
import { manifestFixture } from "../helpers/module-fixtures";

const DRAIN_TIMEOUT_MS = 5000;

const calls: string[] = [];

async function addConstructedModule(
  manager: ModuleManager,
  id: string,
  drain: () => void | Promise<void>,
) {
  const module = new CoreModule(
    manifestFixture({
      name: id,
      version: "1.0.0",
      main: `/${id}/index.js`,
      folder: `/${id}`,
    }),
    sinon.stub().resolves({
      drain,
      stop: () => calls.push(`stop:${id}`),
    }),
  );
  await module.construct({});
  const entry = { module, config: {} };
  manager["loaded"].set(id, entry);
  return entry;
}

describe("ModuleManager drain", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    sinon.restore();
  });

  it("drains only the started modules, not one that is only constructed (fails if drain ignores the module's state)", async () => {
    const manager = new ModuleManager();
    const started = await addConstructedModule(manager, "started", () => {
      calls.push("drain:started");
    });
    await addConstructedModule(manager, "constructed", () => {
      calls.push("drain:constructed");
    });

    await manager.startModules([started]);
    await manager.stopAll();

    expect(calls).to.deep.equal(["drain:started", "stop:started"]);
  });

  it("leaves no owner token for a module never constructed when a teardown drains (fails if drain enters a loaded module's context)", async () => {
    const manager = new ModuleManager();
    const started = await addConstructedModule(manager, "started", () => {
      calls.push("drain:started");
    });
    const neverConstructed = new CoreModule(
      manifestFixture({
        name: "never-constructed",
        version: "1.0.0",
        main: "/never-constructed/index.js",
        folder: "/never-constructed",
      }),
      sinon.stub().resolves({
        drain: () => calls.push("drain:never-constructed"),
      }),
    );
    manager["loaded"].set("never-constructed", {
      module: neverConstructed,
      config: {},
    });

    await manager.startModules([started]);
    await manager.destroyAll();

    expect(calls).to.deep.equal(["drain:started", "stop:started"]);
    expect(
      [...internal.activeOwnerTokens.keys()].filter((owner) =>
        owner.startsWith("never-constructed"),
      ),
    ).to.deep.equal([]);
  });

  it("drains a manager stopped after another manager stopped (fails if whether a manager drains depends on another manager's stop)", async () => {
    const first = new ModuleManager();
    const second = new ModuleManager();
    const a = await addConstructedModule(first, "a", () => {
      calls.push("drain:a");
    });
    const b = await addConstructedModule(second, "b", () => {
      calls.push("drain:b");
    });
    await first.startModules([a]);
    await second.startModules([b]);

    await first.stopAll();
    await second.stopAll();

    expect(calls).to.deep.equal(["drain:a", "stop:a", "drain:b", "stop:b"]);
  });

  it("leaves no drain deadline pending once a manager that never started stopped (fails if the deadline timer outlives the drain)", async () => {
    const manager = new ModuleManager();
    await addConstructedModule(manager, "constructed", () => undefined);
    const clock = sinon.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });

    await manager.stopAll();

    expect(clock.countTimers()).to.equal(0);
  });

  it("starts every drain before any of them settles (fails if drains run one after another)", async () => {
    const clock = sinon.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });
    const manager = new ModuleManager();
    const drainsStarted = new Set<string>();
    let releaseDrains: () => void = () => undefined;
    const bothDraining = new Promise<void>((resolve) => {
      releaseDrains = resolve;
    });
    const drainUntilBothStarted = (id: string) => async () => {
      drainsStarted.add(id);
      if (drainsStarted.size === 2) {
        releaseDrains();
      }
      await bothDraining;
      calls.push(`drain:${id}`);
    };
    const entries = [
      await addConstructedModule(manager, "a", drainUntilBothStarted("a")),
      await addConstructedModule(manager, "b", drainUntilBothStarted("b")),
    ];
    await manager.startModules(entries);

    const stopping = manager.stopAll();
    await clock.tickAsync(DRAIN_TIMEOUT_MS - 1);

    expect(calls.slice(0, 2)).to.have.members(["drain:a", "drain:b"]);
    await stopping;
    expect(calls.slice(2)).to.have.members(["stop:a", "stop:b"]);
  });
});
