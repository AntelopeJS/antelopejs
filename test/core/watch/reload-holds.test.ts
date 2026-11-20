import { Events } from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import sinon from "sinon";

import { ReloadHolds, reloadHolds } from "../../../src/core/runtime";

describe("ReloadHolds", () => {
  it("holds nothing while no watcher runs", async () => {
    const holds = new ReloadHolds();

    const id = holds.take("holder");
    const heldBefore = holds.held;
    await holds.release(id);

    expect(heldBefore).to.equal(false);
  });

  it("runs what the holds deferred once, when the last hold ends", async () => {
    const holds = new ReloadHolds();
    const runHeld = sinon.stub().resolves();
    holds.watch(runHeld);

    const first = holds.take("a");
    const second = holds.take("b");
    await holds.release(first);
    const runsAfterFirst = runHeld.callCount;
    await holds.release(second);

    expect({
      runsAfterFirst,
      runs: runHeld.callCount,
      held: holds.held,
    }).to.deep.equal({
      runsAfterFirst: 0,
      runs: 1,
      held: false,
    });
  });

  it("resolves at once for an unknown or ended id and keeps the open holds", async () => {
    const holds = new ReloadHolds();
    const runHeld = sinon.stub().resolves();
    holds.watch(runHeld);
    const open = holds.take("holder");
    const ended = holds.take("holder");
    await holds.release(ended);

    await holds.release("unknown");
    await holds.release(ended);

    expect({ runs: runHeld.callCount, held: holds.held }).to.deep.equal({
      runs: 0,
      held: true,
    });
    await holds.release(open);
  });

  it("stops holding once its watcher stops", () => {
    const holds = new ReloadHolds();
    const unwatch = holds.watch(async () => {});
    holds.take("holder");

    unwatch();

    expect(holds.held).to.equal(false);
  });

  it("ends the holds of a destroyed module and only those", async () => {
    const runHeld = sinon.stub().resolves();
    const unwatch = reloadHolds.watch(runHeld);
    const kept = reloadHolds.take("other");
    reloadHolds.take("holder");
    reloadHolds.take("holder");

    Events.ModuleDestroyed.emit("holder");
    const heldAfterDestroy = reloadHolds.held;
    await reloadHolds.release(kept);
    unwatch();

    expect({ heldAfterDestroy, runs: runHeld.callCount }).to.deep.equal({
      heldAfterDestroy: true,
      runs: 1,
    });
  });
});
