import { expect } from "chai";
import sinon from "sinon";
import { ModuleLifecycle } from "../../src/core/modules/module-lifecycle";
import { ModuleState } from "../../src/types";
import {
  type DiagnosticsRecorder,
  recordModuleDiagnostics,
  SPAN_EVENT_COUNT,
} from "../helpers/diagnostics-recorder";

const DIAGNOSTICS_MODULE_ID = "diagnostics-lifecycle";

const MODULE_VERSION = "1.0.0";

const RELOADED_VERSION = "2.0.0";
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
});

describe("ModuleLifecycle diagnostics", () => {
  let recorder: DiagnosticsRecorder;

  beforeEach(() => {
    recorder = recordModuleDiagnostics(DIAGNOSTICS_MODULE_ID);
  });

  afterEach(() => {
    recorder.restore();
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
