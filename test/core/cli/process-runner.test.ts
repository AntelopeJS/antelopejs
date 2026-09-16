import { expect } from "chai";
import type { spawn } from "node:child_process";

import {
  runInheritedProcess,
  type ProcessRunner,
  type SignalTarget,
} from "../../../src/core/cli/process-runner";

interface FakeSignalTarget extends SignalTarget {
  emit(signal: NodeJS.Signals): void;
  listenerCount(signal: NodeJS.Signals): number;
}

function createSignalTarget(): FakeSignalTarget {
  const listeners = new Map<NodeJS.Signals, (() => void)[]>();
  return {
    on: (signal, listener) =>
      listeners.set(signal, [...(listeners.get(signal) ?? []), listener]),
    off: (signal, listener) =>
      listeners.set(
        signal,
        (listeners.get(signal) ?? []).filter((entry) => entry !== listener),
      ),
    emit: (signal) => (listeners.get(signal) ?? []).forEach((entry) => entry()),
    listenerCount: (signal) => (listeners.get(signal) ?? []).length,
  };
}

type CloseHandler = (
  code: number | null,
  signal: NodeJS.Signals | null,
) => void;
type ErrorHandler = (error: Error) => void;

interface ControllableChild {
  kills: NodeJS.Signals[];
  close(code: number | null, signal?: NodeJS.Signals | null): void;
  fail(error: Error): void;
}

interface ControllableRunner {
  runner: ProcessRunner;
  calls: { executable: string; args: string[]; options: unknown }[];
  child: ControllableChild;
}

function createControllableRunner(): ControllableRunner {
  const calls: { executable: string; args: string[]; options: unknown }[] = [];
  const kills: NodeJS.Signals[] = [];
  let closeHandler: CloseHandler | undefined;
  let errorHandler: ErrorHandler | undefined;

  const child = {
    kill(signal: NodeJS.Signals) {
      kills.push(signal);
      return true;
    },
    once(event: string, handler: CloseHandler | ErrorHandler) {
      if (event === "close") closeHandler = handler as CloseHandler;
      if (event === "error") errorHandler = handler as ErrorHandler;
      return child;
    },
  };

  return {
    calls,
    child: {
      kills,
      close: (code, signal = null) => closeHandler?.(code, signal),
      fail: (error) => errorHandler?.(error),
    },
    runner: {
      spawn: ((executable: string, args: string[], options: unknown) => {
        calls.push({ executable, args, options });
        return child;
      }) as unknown as typeof spawn,
    },
  };
}

describe("Inherited process runner", () => {
  it("spawns with inherited stdio and verbatim arguments", async () => {
    const { runner, calls, child } = createControllableRunner();

    const result = runInheritedProcess(
      "ajs-dms",
      ["build", "--", "--flag", "value with spaces"],
      runner,
    );
    child.close(0);

    expect(await result).to.equal(0);
    expect(calls).to.deep.equal([
      {
        executable: "ajs-dms",
        args: ["build", "--", "--flag", "value with spaces"],
        options: { stdio: "inherit" },
      },
    ]);
  });

  it("propagates the child exit code", async () => {
    const { runner, child } = createControllableRunner();

    const result = runInheritedProcess("ajs-dms", [], runner);
    child.close(42);

    expect(await result).to.equal(42);
  });

  it("converts a terminating signal into a shell exit code", async () => {
    const { runner, child } = createControllableRunner();

    const result = runInheritedProcess("ajs-dms", [], runner);
    child.close(null, "SIGTERM");

    expect(await result).to.equal(143);
  });

  it("falls back to a failure code when neither code nor signal is reported", async () => {
    const { runner, child } = createControllableRunner();

    const result = runInheritedProcess("ajs-dms", [], runner);
    child.close(null, null);

    expect(await result).to.equal(1);
  });

  it("forwards signals to the child and stops listening after exit", async () => {
    const { runner, child } = createControllableRunner();
    const signals = createSignalTarget();

    const result = runInheritedProcess("ajs-dms", [], runner, signals);
    signals.emit("SIGINT");
    expect(child.kills).to.deep.equal(["SIGINT"]);
    expect(signals.listenerCount("SIGTERM")).to.equal(1);

    child.close(null, "SIGINT");

    expect(await result).to.equal(130);
    expect(signals.listenerCount("SIGINT")).to.equal(0);
    expect(signals.listenerCount("SIGTERM")).to.equal(0);
  });

  it("rejects when the child cannot be spawned", async () => {
    const { runner, child } = createControllableRunner();
    const signals = createSignalTarget();

    const result = runInheritedProcess("ajs-dms", [], runner, signals);
    child.fail(new Error("spawn failed"));

    let thrown: unknown;
    try {
      await result;
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error)?.message).to.equal("spawn failed");
    expect(signals.listenerCount("SIGINT")).to.equal(0);
  });
});
