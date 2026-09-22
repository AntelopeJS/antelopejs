import sinon from "sinon";
import { expect } from "chai";
import {
  Events,
  GetModuleContext,
  type ModuleExecutionContext,
} from "@antelopejs/interface-core/modules";

import { ModuleState } from "../../src/types";
import { Module, type ModuleLoader } from "../../src/core/module";
import {
  type DiagnosticsRecorder,
  recordModuleDiagnostics,
  SPAN_EVENT_COUNT,
} from "../helpers/diagnostics-recorder";

const manifest = {
  name: "mod",
  version: "1.0.0",
  main: "/mod/index.js",
} as any;

describe("Module", () => {
  it("exposes current state", () => {
    const mod = new Module(manifest, sinon.stub().resolves({}));
    expect(mod.state).to.equal(ModuleState.Loaded);
  });

  it("publishes config variables and loads the module only once", async () => {
    const callbacks = {
      provide: sinon.stub().resolves({ API_PORT: 5010 }),
      construct: sinon.spy(),
    };
    const loader = sinon.stub().resolves(callbacks);
    const mod = new Module(manifest, loader);

    const published = await mod.provide({ port: 5010 });
    await mod.construct({ port: 5010 });

    expect(published).to.deep.equal({ API_PORT: 5010 });
    expect(loader.calledOnce).to.equal(true);
    expect(callbacks.provide.calledOnce).to.equal(true);
    expect(callbacks.construct.calledOnce).to.equal(true);
    expect(mod.state).to.equal(ModuleState.Constructed);
  });

  it("publishes nothing once the module is constructed", async () => {
    const callbacks = { provide: sinon.stub().resolves({ API_PORT: 5010 }) };
    const mod = new Module(manifest, sinon.stub().resolves(callbacks));

    await mod.construct({});
    const published = await mod.provide({});

    expect(published).to.equal(undefined);
    expect(callbacks.provide.called).to.equal(false);
  });

  it("reloads the module code after a destroy", async () => {
    const loader = sinon.stub().resolves({ construct: sinon.spy() });
    const mod = new Module(manifest, loader);

    await mod.construct({});
    await mod.destroy();
    await mod.construct({});

    expect(loader.calledTwice).to.equal(true);
  });

  it("should load and run lifecycle callbacks", async () => {
    const callbacks = {
      construct: sinon.spy(),
      start: sinon.spy(),
      stop: sinon.spy(),
      destroy: sinon.spy(),
    };

    const loader = sinon.stub().resolves(callbacks);
    const mod = new Module(manifest, loader);

    await mod.construct({ foo: "bar" });
    await mod.start();
    await mod.stop();
    await mod.destroy();

    expect(loader.calledOnce).to.equal(true);
    expect(callbacks.construct.calledOnce).to.equal(true);
    expect(callbacks.start.calledOnce).to.equal(true);
    expect(callbacks.stop.calledOnce).to.equal(true);
    expect(callbacks.destroy.calledOnce).to.equal(true);
  });

  it("runs a generation in one stable module context", async () => {
    const contexts: ModuleExecutionContext[] = [];
    const capture = () => {
      const context = GetModuleContext();
      if (context) {
        contexts.push(context);
      }
    };
    const mod = new Module(
      { ...manifest, name: "context-module" },
      async () => {
        capture();
        return {
          construct: capture,
          start: capture,
          stop: capture,
          destroy: capture,
        };
      },
    );

    await mod.construct({});
    await mod.start();
    await mod.stop();
    await mod.destroy();

    expect(contexts.map(({ module }) => module)).to.deep.equal(
      Array(5).fill("context-module"),
    );
    expect(new Set(contexts.map(({ owner }) => owner)).size).to.equal(1);
    expect(contexts[0].owner).to.match(/^context-module#\d+$/);
  });

  it("uses distinct owners for replacement generations", async () => {
    const owners: Array<string | undefined> = [];
    const createModule = () =>
      new Module({ ...manifest, name: "replacement" }, async () => ({
        construct: () => {
          owners.push(GetModuleContext()?.owner);
        },
      }));
    const oldModule = createModule();
    const replacement = createModule();

    await oldModule.construct({});
    await replacement.construct({});

    expect(owners[0]).to.not.equal(owners[1]);
  });

  it("updates routes captured by the current module generation", async () => {
    let constructedContext: ModuleExecutionContext | undefined;
    let startedContext: ModuleExecutionContext | undefined;
    const mod = new Module(manifest, async () => ({
      construct: () => {
        constructedContext = GetModuleContext();
      },
      start: () => {
        startedContext = GetModuleContext();
      },
    }));
    mod.setProviderRoutes({ proxy: "provider-a" }, false);
    await mod.construct({});

    mod.setProviderRoutes({ proxy: "provider-b" }, false);
    await mod.start();

    expect(constructedContext?.providerRoutes).to.deep.equal({
      proxy: "provider-b",
    });
    expect(startedContext?.providerRoutes).to.equal(
      constructedContext?.providerRoutes,
    );
  });

  it("emits successful destroy from the generation context after retry", async () => {
    const contexts: ModuleExecutionContext[] = [];
    const emit = Events.ModuleDestroyed.emit.bind(Events.ModuleDestroyed);
    const destroyed = sinon
      .stub(Events.ModuleDestroyed, "emit")
      .callsFake((moduleId) => {
        const context = GetModuleContext();
        if (context) {
          contexts.push(context);
        }
        emit(moduleId);
      });
    const destroy = sinon.stub();
    destroy.onFirstCall().rejects(new Error("destroy failed"));
    destroy.onSecondCall().resolves();
    const mod = new Module(manifest, sinon.stub().resolves({ destroy }));

    try {
      await mod.construct({});
      await mod.destroy().catch(() => undefined);
      await mod.destroy();
      expect(destroyed.calledOnce).to.equal(true);
      expect(contexts[0]).to.include({ module: "mod" });
      expect(contexts[0].owner).to.match(/^mod#\d+$/);
    } finally {
      destroyed.restore();
    }
  });

  it("should not reload callbacks when already constructed", async () => {
    const loader = sinon.stub().resolves({});
    const mod = new Module(manifest, loader);

    await mod.construct({});
    await mod.construct({});

    expect(loader.calledOnce).to.equal(true);
  });

  it("should reload manifest and update version", async () => {
    const reloadManifest = {
      ...manifest,
      version: "1.0.0",
      reload: sinon.stub(),
    } as any;
    reloadManifest.reload.callsFake(async () => {
      reloadManifest.version = "1.0.1";
    });

    const loader = sinon.stub().resolves({});
    const mod = new Module(reloadManifest, loader);

    await mod.reload();

    expect(reloadManifest.reload.calledOnce).to.equal(true);
    expect(mod.version).to.equal("1.0.1");
  });

  it("should throw and log when loader fails during construct", async () => {
    const loader = sinon.stub().rejects(new Error("load failed"));
    const mod = new Module(manifest, loader);

    try {
      await mod.construct({});
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).to.equal("load failed");
    }
  });

  it("should throw and log when manifest reload fails", async () => {
    const reloadManifest = {
      ...manifest,
      reload: sinon.stub().rejects(new Error("reload failed")),
    } as any;

    const loader = sinon.stub().resolves({});
    const mod = new Module(reloadManifest, loader);

    try {
      await mod.reload();
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).to.equal("reload failed");
    }
  });

  it("should throw and log when destroy fails", async () => {
    const callbacks = {
      destroy: sinon.stub().rejects(new Error("destroy failed")),
    };

    const loader = sinon.stub().resolves(callbacks);
    const mod = new Module(manifest, loader);

    await mod.construct({});
    await mod.start();

    try {
      await mod.destroy();
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).to.equal("destroy failed");
    }
  });

  it("should await async stop callback", async () => {
    let stopResolved = false;
    const callbacks = {
      stop: async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        stopResolved = true;
      },
    };

    const loader = sinon.stub().resolves(callbacks);
    const mod = new Module(manifest, loader);

    await mod.construct({});
    await mod.start();
    await mod.stop();

    expect(stopResolved).to.equal(true);
  });
});

const SPANS_PER_CONSTRUCT = 2;

const diagnosticsManifest = {
  ...manifest,
  name: "diagnostics-module",
} as any;

describe("Module diagnostics", () => {
  let recorder: DiagnosticsRecorder;

  beforeEach(() => {
    recorder = recordModuleDiagnostics(diagnosticsManifest.name);
  });

  afterEach(() => {
    recorder.restore();
  });

  it("publishes the load span before the construct span", async () => {
    const mod = new Module(diagnosticsManifest, sinon.stub().resolves({}));

    await mod.construct({});

    expect(recorder.trace()).to.deep.equal([
      "load:start",
      "load:end",
      "load:asyncStart",
      "load:asyncEnd",
      "construct:start",
      "construct:end",
      "construct:asyncStart",
      "construct:asyncEnd",
    ]);
  });

  it("publishes the loaded callbacks as the load span result", async () => {
    const callbacks = { start: sinon.spy() };
    const mod = new Module(
      diagnosticsManifest,
      sinon.stub().resolves(callbacks),
    );

    await mod.construct({});

    const asyncEnd = recorder.events.find(
      ({ operation, event }) => operation === "load" && event === "asyncEnd",
    );
    expect(asyncEnd?.payload.result).to.equal(callbacks);
    expect(asyncEnd?.payload).to.include({
      moduleId: diagnosticsManifest.name,
      moduleVersion: diagnosticsManifest.version,
    });
  });

  it("publishes an error on the load span when the loader fails", async () => {
    const mod = new Module(
      diagnosticsManifest,
      sinon.stub().rejects(new Error("load failed")),
    );

    await mod.construct({}).catch(() => undefined);

    const errors = recorder.events.filter(({ event }) => event === "error");
    expect(errors).to.have.length(1);
    expect(errors[0].operation).to.equal("load");
    expect(errors[0].payload.error).to.have.property("message", "load failed");
    expect(
      recorder.events.some(({ operation }) => operation === "construct"),
    ).to.equal(false);
  });

  it("publishes a well-formed span when the loader throws synchronously", async () => {
    const loader = () => {
      throw new Error("sync load failed");
    };
    const mod = new Module(
      diagnosticsManifest,
      loader as unknown as ModuleLoader,
    );

    await mod.construct({}).catch(() => undefined);

    expect(recorder.trace()).to.deep.equal([
      "load:start",
      "load:end",
      "load:error",
      "load:asyncStart",
      "load:asyncEnd",
    ]);
  });

  it("publishes an undefined version when the manifest declares none", async () => {
    const versionlessManifest = {
      ...diagnosticsManifest,
      version: undefined,
    } as any;
    const mod = new Module(versionlessManifest, sinon.stub().resolves({}));

    await mod.construct({});

    expect(recorder.events).to.have.length(
      SPAN_EVENT_COUNT * SPANS_PER_CONSTRUCT,
    );
    for (const { payload } of recorder.events) {
      expect(payload.moduleId).to.equal(diagnosticsManifest.name);
      expect(payload.moduleVersion).to.equal(undefined);
    }
  });

  it("publishes nothing when construct is called on a constructed module", async () => {
    const mod = new Module(diagnosticsManifest, sinon.stub().resolves({}));

    await mod.construct({});
    recorder.events.length = 0;
    await mod.construct({});

    expect(recorder.trace()).to.deep.equal([]);
  });

  it("publishes the pre-reload version on a destroy span raised by reload", async () => {
    const reloadManifest = {
      ...diagnosticsManifest,
      version: "1.0.0",
      reload: sinon.stub(),
    } as any;
    reloadManifest.reload.callsFake(async () => {
      reloadManifest.version = "1.0.1";
    });
    const mod = new Module(reloadManifest, sinon.stub().resolves({}));

    await mod.construct({});
    await mod.reload();

    const destroyed = recorder.events.filter(
      ({ operation }) => operation === "destroy",
    );
    expect(destroyed).to.have.length(SPAN_EVENT_COUNT);
    for (const { payload } of destroyed) {
      expect(payload.moduleVersion).to.equal("1.0.0");
    }
    expect(mod.version).to.equal("1.0.1");
  });
});
