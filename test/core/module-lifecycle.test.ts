import sinon from "sinon";
import { expect } from "chai";

import { ModuleState } from "../../src/types";
import { ModuleLifecycle } from "../../src/core/module-lifecycle";
import {
  type DiagnosticsRecorder,
  recordModuleDiagnostics,
  SPAN_EVENT_COUNT,
} from "../helpers/diagnostics-recorder";

const MODULE_ID = "mod";
const DIAGNOSTICS_MODULE_ID = "diagnostics-lifecycle";
const MODULE_VERSION = "1.0.0";
const RELOADED_VERSION = "2.0.0";

describe("ModuleLifecycle", () => {
  it("returns the config variables the provide callback published", async () => {
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
    lifecycle.setCallbacks({ provide: () => ({ API_PORT: 5010 }) });

    expect(await lifecycle.provide({})).to.deep.equal({ API_PORT: 5010 });
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it("returns undefined for a module that publishes nothing", async () => {
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
    lifecycle.setCallbacks({ construct: () => undefined });

    expect(await lifecycle.provide({})).to.equal(undefined);
    expect(await lifecycle.construct({})).to.equal(undefined);
  });

  it("should transition through lifecycle states", async () => {
    const calls: string[] = [];
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);

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
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
    lifecycle.setCallbacks(callbacks);

    await lifecycle.start();
    await lifecycle.stop();

    expect(callbacks.start.called).to.equal(false);
    expect(callbacks.stop.called).to.equal(false);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it("should not construct twice", async () => {
    const callbacks = { construct: sinon.spy() };
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
    lifecycle.setCallbacks(callbacks);

    await lifecycle.construct({});
    await lifecycle.construct({});

    expect(callbacks.construct.calledOnce).to.equal(true);
    expect(lifecycle.state).to.equal(ModuleState.Constructed);
  });

  it("allows cleanup after construct fails", async () => {
    const destroy = sinon.stub().resolves();
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
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
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
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
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
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
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
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
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
    lifecycle.setCallbacks(callbacks);

    await lifecycle.destroy();

    expect(callbacks.destroy.called).to.equal(false);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it("should await async start callback before becoming active", async () => {
    const calls: string[] = [];
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);

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
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
    lifecycle.setCallbacks({ start });

    await lifecycle.construct({});
    await Promise.all([lifecycle.start(), lifecycle.start()]);

    expect(start.calledOnce).to.equal(true);
    expect(lifecycle.state).to.equal(ModuleState.Active);
  });

  it("should stop a module whose start is still pending", async () => {
    const calls: string[] = [];
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);

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
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);

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
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
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
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);

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
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
    lifecycle.setCallbacks({ construct });

    await Promise.all([lifecycle.construct({}), lifecycle.construct({})]);

    expect(construct.calledOnce).to.equal(true);
    expect(lifecycle.state).to.equal(ModuleState.Constructed);
  });

  it("serializes overlapping stop and destroy calls", async () => {
    const calls: string[] = [];
    const lifecycle = new ModuleLifecycle(MODULE_ID, MODULE_VERSION);
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

describe("ModuleLifecycle diagnostics", () => {
  let recorder: DiagnosticsRecorder;

  beforeEach(() => {
    recorder = recordModuleDiagnostics(DIAGNOSTICS_MODULE_ID);
  });

  afterEach(() => {
    recorder.restore();
  });

  it("publishes one span per transition, in lifecycle order", async () => {
    const lifecycle = new ModuleLifecycle(
      DIAGNOSTICS_MODULE_ID,
      MODULE_VERSION,
    );
    lifecycle.setCallbacks({});

    await lifecycle.construct({});
    await lifecycle.start();
    await lifecycle.stop();
    await lifecycle.destroy();

    expect(recorder.trace()).to.deep.equal([
      "construct:start",
      "construct:end",
      "construct:asyncStart",
      "construct:asyncEnd",
      "start:start",
      "start:end",
      "start:asyncStart",
      "start:asyncEnd",
      "stop:start",
      "stop:end",
      "stop:asyncStart",
      "stop:asyncEnd",
      "destroy:start",
      "destroy:end",
      "destroy:asyncStart",
      "destroy:asyncEnd",
    ]);
  });

  it("publishes the module id and version on every event of a span", async () => {
    const lifecycle = new ModuleLifecycle(
      DIAGNOSTICS_MODULE_ID,
      MODULE_VERSION,
    );
    lifecycle.setCallbacks({});

    await lifecycle.construct({});

    expect(recorder.trace()).to.deep.equal([
      "construct:start",
      "construct:end",
      "construct:asyncStart",
      "construct:asyncEnd",
    ]);
    for (const { payload } of recorder.events) {
      expect(payload.moduleId).to.equal(DIAGNOSTICS_MODULE_ID);
      expect(payload.moduleVersion).to.equal(MODULE_VERSION);
    }
  });

  it("never publishes the module configuration", async () => {
    const lifecycle = new ModuleLifecycle(
      DIAGNOSTICS_MODULE_ID,
      MODULE_VERSION,
    );
    lifecycle.setCallbacks({});

    await lifecycle.construct({ secret: "value" });

    expect(recorder.events).to.have.length(SPAN_EVENT_COUNT);
    for (const { payload } of recorder.events) {
      expect(Object.keys(payload)).to.not.include("config");
      expect(JSON.stringify(payload)).to.not.contain("secret");
    }
  });

  it("publishes the version set most recently", async () => {
    const lifecycle = new ModuleLifecycle(
      DIAGNOSTICS_MODULE_ID,
      MODULE_VERSION,
    );
    lifecycle.setCallbacks({});

    await lifecycle.construct({});
    lifecycle.setVersion(RELOADED_VERSION);
    await lifecycle.start();

    const versions = recorder.events
      .filter(({ operation }) => operation === "start")
      .map(({ payload }) => payload.moduleVersion);
    expect(versions).to.deep.equal(
      Array(SPAN_EVENT_COUNT).fill(RELOADED_VERSION),
    );
    const constructed = recorder.events
      .filter(({ operation }) => operation === "construct")
      .map(({ payload }) => payload.moduleVersion);
    expect(constructed).to.deep.equal(
      Array(SPAN_EVENT_COUNT).fill(MODULE_VERSION),
    );
  });

  it("publishes nothing for transitions the guard rejects", async () => {
    const lifecycle = new ModuleLifecycle(
      DIAGNOSTICS_MODULE_ID,
      MODULE_VERSION,
    );
    lifecycle.setCallbacks({});

    await lifecycle.start();
    await lifecycle.stop();
    await lifecycle.destroy();

    expect(recorder.trace()).to.deep.equal([]);
  });

  it("publishes nothing for a second construct", async () => {
    const lifecycle = new ModuleLifecycle(
      DIAGNOSTICS_MODULE_ID,
      MODULE_VERSION,
    );
    lifecycle.setCallbacks({});

    await lifecycle.construct({});
    const spansAfterFirst = recorder.trace().length;
    await lifecycle.construct({});

    expect(recorder.trace()).to.have.length(spansAfterFirst);
  });

  it("publishes an error event when a callback rejects", async () => {
    const lifecycle = new ModuleLifecycle(
      DIAGNOSTICS_MODULE_ID,
      MODULE_VERSION,
    );
    lifecycle.setCallbacks({
      start: sinon.stub().rejects(new Error("start failed")),
    });

    await lifecycle.construct({});
    await lifecycle.start().catch(() => undefined);

    const errors = recorder.events.filter(({ event }) => event === "error");
    expect(errors).to.have.length(1);
    expect(errors[0].operation).to.equal("start");
    expect(errors[0].payload.error).to.have.property("message", "start failed");
    expect(errors[0].payload.moduleId).to.equal(DIAGNOSTICS_MODULE_ID);
  });

  it("nests the stop span inside the destroy span", async () => {
    const lifecycle = new ModuleLifecycle(
      DIAGNOSTICS_MODULE_ID,
      MODULE_VERSION,
    );
    lifecycle.setCallbacks({});

    await lifecycle.construct({});
    await lifecycle.start();
    recorder.events.length = 0;
    await lifecycle.destroy();

    expect(recorder.trace()).to.deep.equal([
      "destroy:start",
      "stop:start",
      "stop:end",
      "destroy:end",
      "stop:asyncStart",
      "stop:asyncEnd",
      "destroy:asyncStart",
      "destroy:asyncEnd",
    ]);
  });

  it("reports the nested stop failure on the destroy span", async () => {
    const lifecycle = new ModuleLifecycle(
      DIAGNOSTICS_MODULE_ID,
      MODULE_VERSION,
    );
    lifecycle.setCallbacks({
      stop: sinon.stub().rejects(new Error("stop failed")),
      destroy: sinon.stub().resolves(),
    });

    await lifecycle.construct({});
    await lifecycle.start();
    recorder.events.length = 0;
    await lifecycle.destroy().catch(() => undefined);

    const failed = recorder.events.filter(({ event }) => event === "error");
    expect(failed.map(({ operation }) => operation)).to.deep.equal([
      "stop",
      "destroy",
    ]);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it("publishes no error on a span that succeeded", async () => {
    const lifecycle = new ModuleLifecycle(
      DIAGNOSTICS_MODULE_ID,
      MODULE_VERSION,
    );
    lifecycle.setCallbacks({});

    await lifecycle.construct({});
    await lifecycle.destroy();

    const destroyed = recorder.events.filter(
      ({ operation }) => operation === "destroy",
    );
    expect(destroyed).to.have.length(SPAN_EVENT_COUNT);
    for (const { payload } of destroyed) {
      expect(payload.error).to.equal(undefined);
    }
  });
});
