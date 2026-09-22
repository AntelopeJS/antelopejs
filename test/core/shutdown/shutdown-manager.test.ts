import sinon from "sinon";
import { expect } from "chai";
import { EventEmitter } from "node:events";

import { ShutdownManager } from "../../../src/core/shutdown/shutdown-manager";

const WAIT_FOR_SIGNAL_MS = 10;
const CUSTOM_TIMEOUT_MS = 500;
/* Short enough that a shutdown left hanging by a test drains inside the
   teardown below, instead of exiting the runner ten seconds later. */
const SUITE_TIMEOUT_MS = 50;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, WAIT_FOR_SIGNAL_MS);
  });
}

describe("ShutdownManager", () => {
  let manager: ShutdownManager;
  /* Signals are delivered on an emitter of this suite's own rather than on
     `process`: a real SIGINT reaches every listener the process carries,
     including managers other suites left armed, and tears down the runner
     itself ten seconds later. */
  let signals: EventEmitter;

  beforeEach(() => {
    signals = new EventEmitter();
    manager = new ShutdownManager(SUITE_TIMEOUT_MS, signals);
  });

  afterEach(async () => {
    manager.removeSignalHandlers();
    /* Drains a shutdown a test left in flight while `process.exit` is still
       stubbed: an abandoned one calls it for real once its handlers time out,
       taking the runner with it. */
    await manager.shutdown();
    sinon.restore();
  });

  describe("handler registration and execution", () => {
    it("should execute registered handlers on shutdown", async () => {
      const handler = sinon.stub().resolves();
      manager.register(handler, 0);

      await manager.shutdown();

      expect(handler.calledOnce).to.equal(true);
    });

    it("should execute handlers in descending priority order", async () => {
      const calls: number[] = [];
      manager.register(async () => {
        calls.push(1);
      }, 1);
      manager.register(async () => {
        calls.push(3);
      }, 3);
      manager.register(async () => {
        calls.push(2);
      }, 2);

      await manager.shutdown();

      expect(calls).to.deep.equal([3, 2, 1]);
    });

    it("should not execute unregistered handlers", async () => {
      const handler = sinon.stub().resolves();
      manager.register(handler, 0);
      manager.unregister(handler);

      await manager.shutdown();

      expect(handler.called).to.equal(false);
    });

    it("should continue executing remaining handlers when one fails", async () => {
      const calls: number[] = [];
      manager.register(async () => {
        calls.push(1);
      }, 1);
      manager.register(async () => {
        throw new Error("fail");
      }, 2);
      manager.register(async () => {
        calls.push(3);
      }, 3);

      await manager.shutdown();

      expect(calls).to.deep.equal([3, 1]);
    });

    it("should only execute shutdown once", async () => {
      const handler = sinon.stub().resolves();
      manager.register(handler, 0);

      await Promise.all([manager.shutdown(), manager.shutdown()]);

      expect(handler.calledOnce).to.equal(true);
    });

    it("should keep first non-zero exit code when shutdown is already running", async () => {
      const deferred = createDeferred();
      const exitStub = sinon.stub(process, "exit");
      manager.register(() => deferred.promise, 0);

      const firstShutdown = manager.shutdown(0);
      const secondShutdown = manager.shutdown(1);
      deferred.resolve();

      await Promise.all([firstShutdown, secondShutdown]);

      expect(exitStub.calledOnceWith(1)).to.equal(true);
    });
  });

  describe("timeout", () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
      clock = sinon.useFakeTimers();
    });

    afterEach(() => {
      clock.restore();
    });

    it("should force resolve after timeout when handler hangs", async () => {
      manager = new ShutdownManager(CUSTOM_TIMEOUT_MS);
      const neverResolves = () => new Promise<void>(() => {});
      manager.register(neverResolves, 0);

      const shutdownPromise = manager.shutdown();
      clock.tick(CUSTOM_TIMEOUT_MS);

      await shutdownPromise;
    });
  });

  describe("signal handling", () => {
    it("should setup and remove signal listeners", () => {
      manager.setupSignalHandlers();

      expect(signals.listenerCount("SIGINT")).to.equal(1);
      expect(signals.listenerCount("SIGTERM")).to.equal(1);

      manager.removeSignalHandlers();

      expect(signals.listenerCount("SIGINT")).to.equal(0);
      expect(signals.listenerCount("SIGTERM")).to.equal(0);
    });

    it("should leave the process signal listeners alone", () => {
      const sigintCount = process.listenerCount("SIGINT");
      const sigtermCount = process.listenerCount("SIGTERM");

      manager.setupSignalHandlers();

      expect(process.listenerCount("SIGINT")).to.equal(sigintCount);
      expect(process.listenerCount("SIGTERM")).to.equal(sigtermCount);
    });

    it("listens on the process by default", () => {
      const processManager = new ShutdownManager();
      const sigintCount = process.listenerCount("SIGINT");

      processManager.setupSignalHandlers();
      expect(process.listenerCount("SIGINT")).to.equal(sigintCount + 1);

      processManager.removeSignalHandlers();
      expect(process.listenerCount("SIGINT")).to.equal(sigintCount);
    });

    it("should trigger shutdown on SIGINT", async () => {
      const handler = sinon.stub().resolves();
      const exitStub = sinon.stub(process, "exit");
      manager.register(handler, 0);
      manager.setupSignalHandlers();

      signals.emit("SIGINT");
      await waitForSignal();

      expect(handler.calledOnce).to.equal(true);
      expect(exitStub.calledWith(0)).to.equal(true);
    });

    it("should trigger shutdown on SIGTERM", async () => {
      const handler = sinon.stub().resolves();
      const exitStub = sinon.stub(process, "exit");
      manager.register(handler, 0);
      manager.setupSignalHandlers();

      signals.emit("SIGTERM");
      await waitForSignal();

      expect(handler.calledOnce).to.equal(true);
      expect(exitStub.calledWith(0)).to.equal(true);
    });

    it("should force exit on second signal during shutdown", async () => {
      const neverResolves = () => new Promise<void>(() => {});
      const exitStub = sinon.stub(process, "exit");
      manager.register(neverResolves, 0);
      manager.setupSignalHandlers();

      signals.emit("SIGINT");
      await waitForSignal();

      signals.emit("SIGINT");

      expect(exitStub.calledWith(1)).to.equal(true);
    });

    it("should not force exit on SIGTERM received during graceful shutdown", async () => {
      const deferred = createDeferred();
      const handler = sinon.stub().returns(deferred.promise);
      const exitStub = sinon.stub(process, "exit");
      manager.register(handler, 0);
      manager.setupSignalHandlers();

      signals.emit("SIGINT");
      await waitForSignal();

      signals.emit("SIGTERM");
      await waitForSignal();

      expect(exitStub.calledWith(1)).to.equal(false);
      expect(handler.calledOnce).to.equal(true);

      deferred.resolve();
      await waitForSignal();

      expect(exitStub.calledWith(0)).to.equal(true);
    });

    it("should not force exit on SIGINT received after SIGTERM starts shutdown", async () => {
      const deferred = createDeferred();
      const handler = sinon.stub().returns(deferred.promise);
      const exitStub = sinon.stub(process, "exit");
      manager.register(handler, 0);
      manager.setupSignalHandlers();

      signals.emit("SIGTERM");
      await waitForSignal();

      signals.emit("SIGINT");
      await waitForSignal();

      expect(exitStub.calledWith(1)).to.equal(false);
      expect(handler.calledOnce).to.equal(true);

      deferred.resolve();
      await waitForSignal();

      expect(exitStub.calledWith(0)).to.equal(true);
    });
  });
});
