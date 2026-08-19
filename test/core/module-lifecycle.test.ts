import { expect } from "chai";
import sinon from "sinon";
import { ModuleLifecycle } from "../../src/core/module-lifecycle";
import { ModuleState } from "../../src/types";

describe("ModuleLifecycle", () => {
  it("should transition through lifecycle states", async () => {
    const calls: string[] = [];
    const lifecycle = new ModuleLifecycle("mod");

    lifecycle.setCallbacks({
      construct: () => {
        calls.push("construct");
      },
      start: () => {
        calls.push("start");
      },
      stop: () => {
        calls.push("stop");
      },
      destroy: () => {
        calls.push("destroy");
      },
    });

    expect(lifecycle.state).to.equal(ModuleState.Loaded);

    await lifecycle.construct({});
    expect(lifecycle.state).to.equal(ModuleState.Constructed);

    await lifecycle.start();
    expect(lifecycle.state).to.equal(ModuleState.Active);

    await lifecycle.stop();
    expect(lifecycle.state).to.equal(ModuleState.Constructed);

    await lifecycle.destroy();
    expect(lifecycle.state).to.equal(ModuleState.Loaded);

    expect(calls).to.deep.equal(["construct", "start", "stop", "destroy"]);
  });

  it("should ignore start/stop when in the wrong state", async () => {
    const callbacks = {
      start: sinon.spy(),
      stop: sinon.spy(),
    };
    const lifecycle = new ModuleLifecycle("mod");
    lifecycle.setCallbacks(callbacks);

    await lifecycle.start();
    await lifecycle.stop();

    expect(callbacks.start.called).to.equal(false);
    expect(callbacks.stop.called).to.equal(false);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it("should not construct twice", async () => {
    const callbacks = { construct: sinon.spy() };
    const lifecycle = new ModuleLifecycle("mod");
    lifecycle.setCallbacks(callbacks);

    await lifecycle.construct({});
    await lifecycle.construct({});

    expect(callbacks.construct.calledOnce).to.equal(true);
    expect(lifecycle.state).to.equal(ModuleState.Constructed);
  });

  it("allows cleanup after construct fails", async () => {
    const destroy = sinon.stub().resolves();
    const lifecycle = new ModuleLifecycle("mod");
    lifecycle.setCallbacks({
      construct: async () => {
        throw new Error("construct failed");
      },
      destroy,
    });

    await lifecycle.construct({}).catch(() => undefined);
    expect(lifecycle.state).to.equal(ModuleState.Constructed);

    await lifecycle.destroy();
    expect(destroy.calledOnce).to.equal(true);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it("should stop active modules during destroy", async () => {
    const callbacks = {
      stop: sinon.spy(),
      destroy: sinon.spy(),
    };
    const lifecycle = new ModuleLifecycle("mod");
    lifecycle.setCallbacks(callbacks);

    await lifecycle.construct({});
    await lifecycle.start();
    await lifecycle.destroy();

    expect(callbacks.stop.calledOnce).to.equal(true);
    expect(callbacks.destroy.calledOnce).to.equal(true);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it("attempts destroy after stop fails and reports the stop error", async () => {
    const destroy = sinon.stub().resolves();
    const lifecycle = new ModuleLifecycle("mod");
    lifecycle.setCallbacks({
      stop: sinon.stub().rejects(new Error("stop failed")),
      destroy,
    });
    await lifecycle.construct({});
    await lifecycle.start();

    let thrown: unknown;
    try {
      await lifecycle.destroy();
    } catch (error) {
      thrown = error;
    }

    expect(destroy.calledOnce).to.equal(true);
    expect(thrown).to.have.property("message", "stop failed");
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it("aggregates stop and destroy failures and retries both phases", async () => {
    const stop = sinon
      .stub()
      .onFirstCall()
      .rejects(new Error("stop failed"))
      .onSecondCall()
      .resolves();
    const destroy = sinon
      .stub()
      .onFirstCall()
      .rejects(new Error("destroy failed"))
      .onSecondCall()
      .resolves();
    const lifecycle = new ModuleLifecycle("mod");
    lifecycle.setCallbacks({ stop, destroy });
    await lifecycle.construct({});
    await lifecycle.start();

    let thrown: unknown;
    try {
      await lifecycle.destroy();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(AggregateError);
    expect((thrown as AggregateError).errors).to.have.length(2);
    expect(lifecycle.state).to.equal(ModuleState.Active);

    await lifecycle.destroy();
    expect(stop.calledTwice).to.equal(true);
    expect(destroy.calledTwice).to.equal(true);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it("should do nothing on destroy when already loaded", async () => {
    const callbacks = { destroy: sinon.spy() };
    const lifecycle = new ModuleLifecycle("mod");
    lifecycle.setCallbacks(callbacks);

    await lifecycle.destroy();

    expect(callbacks.destroy.called).to.equal(false);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it("should await async start callback before becoming active", async () => {
    const calls: string[] = [];
    const lifecycle = new ModuleLifecycle("mod");

    lifecycle.setCallbacks({
      start: async () => {
        await new Promise((resolve) => {
          setImmediate(resolve);
        });
        calls.push("start");
      },
    });

    await lifecycle.construct({});
    const starting = lifecycle.start();
    expect(lifecycle.state).to.equal(ModuleState.Constructed);

    await starting;
    expect(calls).to.deep.equal(["start"]);
    expect(lifecycle.state).to.equal(ModuleState.Active);
  });

  it("should run the start callback once when starts overlap", async () => {
    const start = sinon.stub().callsFake(
      () =>
        new Promise<void>((resolve) => {
          setImmediate(resolve);
        }),
    );
    const lifecycle = new ModuleLifecycle("mod");
    lifecycle.setCallbacks({ start });

    await lifecycle.construct({});
    await Promise.all([lifecycle.start(), lifecycle.start()]);

    expect(start.calledOnce).to.equal(true);
    expect(lifecycle.state).to.equal(ModuleState.Active);
  });

  it("should stop a module whose start is still pending", async () => {
    const calls: string[] = [];
    const lifecycle = new ModuleLifecycle("mod");

    lifecycle.setCallbacks({
      start: async () => {
        await new Promise((resolve) => {
          setImmediate(resolve);
        });
        calls.push("start");
      },
      stop: () => {
        calls.push("stop");
      },
    });

    await lifecycle.construct({});
    const starting = lifecycle.start();
    await Promise.all([lifecycle.stop(), starting]);

    expect(calls).to.deep.equal(["start", "stop"]);
    expect(lifecycle.state).to.equal(ModuleState.Constructed);
  });

  it("should destroy a module whose start is still pending", async () => {
    const calls: string[] = [];
    const lifecycle = new ModuleLifecycle("mod");

    lifecycle.setCallbacks({
      start: async () => {
        await new Promise((resolve) => {
          setImmediate(resolve);
        });
        calls.push("start");
      },
      stop: () => {
        calls.push("stop");
      },
      destroy: () => {
        calls.push("destroy");
      },
    });

    await lifecycle.construct({});
    const starting = lifecycle.start();
    await Promise.all([lifecycle.destroy(), starting]);

    expect(calls).to.deep.equal(["start", "stop", "destroy"]);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it("should stay startable after a failed start", async () => {
    const start = sinon
      .stub()
      .onFirstCall()
      .rejects(new Error("boom"))
      .onSecondCall()
      .resolves();
    const lifecycle = new ModuleLifecycle("mod");
    lifecycle.setCallbacks({ start });

    await lifecycle.construct({});
    await lifecycle.start().then(
      () => expect.fail("start should have rejected"),
      (err: Error) => expect(err.message).to.equal("boom"),
    );
    expect(lifecycle.state).to.equal(ModuleState.Constructed);

    await lifecycle.start();
    expect(lifecycle.state).to.equal(ModuleState.Active);
  });

  it("should await async stop callback", async () => {
    const calls: string[] = [];
    const lifecycle = new ModuleLifecycle("mod");

    lifecycle.setCallbacks({
      construct: () => {
        calls.push("construct");
      },
      start: () => {
        calls.push("start");
      },
      stop: async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        calls.push("stop");
      },
      destroy: () => {
        calls.push("destroy");
      },
    });

    await lifecycle.construct({});
    await lifecycle.start();
    await lifecycle.stop();
    await lifecycle.destroy();

    expect(calls).to.deep.equal(["construct", "start", "stop", "destroy"]);
  });

  it("serializes overlapping construct calls", async () => {
    const construct = sinon.stub().callsFake(
      () =>
        new Promise<void>((resolve) => {
          setImmediate(resolve);
        }),
    );
    const lifecycle = new ModuleLifecycle("mod");
    lifecycle.setCallbacks({ construct });

    await Promise.all([lifecycle.construct({}), lifecycle.construct({})]);

    expect(construct.calledOnce).to.equal(true);
    expect(lifecycle.state).to.equal(ModuleState.Constructed);
  });

  it("serializes overlapping stop and destroy calls", async () => {
    const calls: string[] = [];
    const lifecycle = new ModuleLifecycle("mod");
    lifecycle.setCallbacks({
      start: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        calls.push("start");
      },
      stop: () => {
        calls.push("stop");
      },
      destroy: () => {
        calls.push("destroy");
      },
    });

    await lifecycle.construct({});
    await Promise.all([
      lifecycle.start(),
      lifecycle.stop(),
      lifecycle.stop(),
      lifecycle.destroy(),
      lifecycle.destroy(),
    ]);

    expect(calls).to.deep.equal(["start", "stop", "destroy"]);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });
});
