import { expect } from "chai";
import sinon from "sinon";

import { HotReload } from "../../../src/core/runtime";

describe("HotReload", () => {
  it("should batch reloads within debounce window", async () => {
    const calls: string[] = [];
    const hotReload = new HotReload(
      async (id) => {
        calls.push(id);
      },
      undefined,
      10,
    );

    hotReload.queue("a");
    hotReload.queue("b");
    hotReload.queue("a");

    await new Promise((r) => setTimeout(r, 30));

    expect(calls.sort()).to.deep.equal(["a", "b"]);
  });

  it("should continue reloading remaining modules when one fails", async () => {
    const reloaded: string[] = [];
    const hotReload = new HotReload(
      async (id) => {
        if (id === "failing") {
          throw new Error("tsc compilation failed");
        }
        reloaded.push(id);
      },
      undefined,
      10,
    );

    hotReload.queue("failing");
    hotReload.queue("working");

    await new Promise((r) => setTimeout(r, 30));

    expect(reloaded).to.deep.equal(["working"]);
  });

  it("queues changes while held and reloads each module once when settled", async () => {
    const calls: string[] = [];
    let held = true;
    const hotReload = new HotReload(
      async (id) => {
        await new Promise((r) => setTimeout(r, 5));
        calls.push(id);
      },
      () => held,
      1,
    );

    hotReload.queue("a");
    hotReload.queue("b");
    hotReload.queue("a");
    await new Promise((r) => setTimeout(r, 20));
    const callsWhileHeld = [...calls];
    held = false;
    await hotReload.settle();

    expect({ callsWhileHeld, calls: calls.sort() }).to.deep.equal({
      callsWhileHeld: [],
      calls: ["a", "b"],
    });
  });

  it("settles without reloading what a new hold queued", async () => {
    let held = false;
    const reload = sinon.stub().callsFake(async () => {
      held = true;
      hotReload.queue("b");
    });
    const hotReload = new HotReload(reload, () => held, 1);

    hotReload.queue("a");
    await hotReload.settle();

    expect(reload.args).to.deep.equal([["a"]]);
  });

  it("should cancel pending reload on clear", () => {
    const clock = sinon.useFakeTimers();
    const reload = sinon.stub();
    const hotReload = new HotReload(reload);

    hotReload.queue("modA");
    hotReload.clear();
    clock.tick(600);

    expect(reload.called).to.equal(false);
    clock.restore();
  });
});
