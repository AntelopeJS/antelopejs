import sinon from "sinon";
import { expect } from "chai";

import type { ModuleManager } from "../../../src/core/module-manager";
import type { ShutdownManager } from "../../../src/core/shutdown";
import * as processTree from "../../../src/core/shutdown/process-tree";
import { captureOutputAsync } from "../../helpers/capture-output";
import {
  CANCELLED_EXIT_CODE,
  SUCCESS_EXIT_CODE,
} from "../../../src/core/cli/exit-codes";
import {
  DEFAULT_RUNTIME_POLICY,
  EMBEDDED_RUNTIME_POLICY,
  resolveRuntimePolicy,
} from "../../../src/core/runtime/runtime-policy";
import {
  claimProcess,
  createShutdownManager,
  getActiveShutdownManager,
  registerModuleShutdownHandler,
} from "../../../src/core/runtime/process-claim";

const SHUTDOWN_TIMEOUT_MS = 10000;

type ProcessSignal = "SIGINT" | "SIGTERM";

function sendSignal(manager: ShutdownManager, signal: ProcessSignal): void {
  (manager as any).handleSignal(signal);
}

function hang(): Promise<void> {
  return new Promise<void>(() => undefined);
}

describe("runtime process claim", () => {
  let exit: sinon.SinonStub;

  beforeEach(() => {
    exit = sinon.stub(process, "exit");
    sinon.stub(processTree, "terminateProcessTree").resolves([]);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("answers SIGINT and SIGTERM for the project until it stopped", async () => {
    const previous = getActiveShutdownManager();
    const listenersBefore = process.listeners("SIGINT");
    const manager = createShutdownManager(DEFAULT_RUNTIME_POLICY);

    claimProcess(manager, DEFAULT_RUNTIME_POLICY);
    const added = process
      .listeners("SIGINT")
      .filter((listener) => !listenersBefore.includes(listener));
    expect(getActiveShutdownManager()).to.equal(manager);
    expect(added).to.have.length(1);

    await manager.shutdown();

    expect(getActiveShutdownManager()).to.equal(previous);
    expect(process.listeners("SIGINT")).to.not.include(added[0]);
  });

  it("leaves the signals and child processes to an embedding host", async () => {
    const sigintCount = process.listenerCount("SIGINT");
    const manager = createShutdownManager(EMBEDDED_RUNTIME_POLICY);

    claimProcess(manager, EMBEDDED_RUNTIME_POLICY);
    await manager.shutdown();

    expect(process.listenerCount("SIGINT")).to.equal(sigintCount);
    expect(
      (processTree.terminateProcessTree as sinon.SinonStub).called,
    ).to.equal(false);
  });

  it("says the project is stopping, then that it stopped, and exits with 130", async () => {
    const manager = createShutdownManager(DEFAULT_RUNTIME_POLICY);
    claimProcess(manager, DEFAULT_RUNTIME_POLICY);

    const output = await captureOutputAsync(async () => {
      sendSignal(manager, "SIGINT");
      await manager.shutdown();
    });

    expect(output.stderr).to.contain("Stopped the project");
    expect(exit.calledOnceWith(CANCELLED_EXIT_CODE)).to.equal(true);
    expect(
      (processTree.terminateProcessTree as sinon.SinonStub).calledOnce,
    ).to.equal(true);
  });

  it("exits with 0 after a graceful stop on SIGTERM", async () => {
    const manager = createShutdownManager(DEFAULT_RUNTIME_POLICY);

    await captureOutputAsync(async () => {
      sendSignal(manager, "SIGTERM");
      await manager.shutdown();
    });

    expect(exit.calledOnceWith(SUCCESS_EXIT_CODE)).to.equal(true);
  });

  it("prints nothing when the runtime does not own the terminal", async () => {
    const policy = resolveRuntimePolicy({ terminal: false });
    const manager = createShutdownManager(policy);

    const output = await captureOutputAsync(async () => {
      sendSignal(manager, "SIGINT");
      await manager.shutdown();
    });

    expect(output.stderr).to.equal("");
  });

  it("warns when the modules did not stop in time", async () => {
    const clock = sinon.useFakeTimers();
    const manager = createShutdownManager(DEFAULT_RUNTIME_POLICY);
    manager.register(hang, 0);

    const output = await captureOutputAsync(async () => {
      sendSignal(manager, "SIGINT");
      await clock.tickAsync(SHUTDOWN_TIMEOUT_MS);
    });

    expect(output.stderr).to.contain(
      "Stopped the project after the shutdown timed out",
    );
    expect(exit.calledOnceWith(CANCELLED_EXIT_CODE)).to.equal(true);
  });

  it("kills the child processes at once when Ctrl+C is pressed again", async () => {
    const kill = sinon.stub(processTree, "killProcessTree").returns([]);
    const manager = createShutdownManager(DEFAULT_RUNTIME_POLICY);
    let release: () => void = () => undefined;
    manager.register(
      () => new Promise<void>((resolve) => (release = resolve)),
      0,
    );

    const output = await captureOutputAsync(async () => {
      sendSignal(manager, "SIGINT");
      sendSignal(manager, "SIGINT");
      release();
      await manager.shutdown();
    });

    expect(kill.calledOnce).to.equal(true);
    expect(output.stderr).to.contain(
      "Stopped the project without waiting for its shutdown",
    );
    expect(exit.firstCall.calledWith(CANCELLED_EXIT_CODE)).to.equal(true);
  });

  it("stops and destroys the modules, reporting both failures", async () => {
    const manager = createShutdownManager(EMBEDDED_RUNTIME_POLICY);
    const modules = {
      stopAll: sinon.stub().rejects(new Error("stop failed")),
      destroyAll: sinon.stub().rejects(new Error("destroy failed")),
    };

    const handler = registerModuleShutdownHandler(
      manager,
      modules as unknown as ModuleManager,
    );

    let thrown: unknown;
    try {
      await handler();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).to.be.instanceOf(AggregateError);
    expect((thrown as AggregateError).errors).to.have.length(2);
    expect(modules.destroyAll.calledAfter(modules.stopAll)).to.equal(true);
  });
});
