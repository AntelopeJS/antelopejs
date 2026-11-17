import { expect } from "chai";
import sinon from "sinon";

import { Module as CoreModule, ModuleManager } from "../../src/core/modules";
import { manifestFixture } from "../helpers/module-fixtures";

const DRAIN_TIMEOUT_MS = 5000;

describe("ModuleManager drain", () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    sinon.restore();
  });

  async function addConstructedModule(
    manager: ModuleManager,
    id: string,
    drain: () => void | Promise<void>,
  ) {
    const module = new CoreModule(
      manifestFixture({ name: id, version: "1.0.0", main: `/${id}/index.js` }),
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
