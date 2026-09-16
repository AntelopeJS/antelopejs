import type { CommandOutput } from "../../src/core/cli/cli-ui";
import type { PluginPackageReader } from "../../src/core/cli/plugin-package";
import type { GlobalRootResolver } from "../../src/core/cli/global-package-manager";
import type {
  ForwardedSignal,
  InheritedSpawnOptions,
  ProcessCloseListener,
  ProcessErrorListener,
  ProcessRunner,
  SignalTarget,
  SpawnedProcess,
} from "../../src/core/cli/process-runner";

export interface SpawnCall {
  executable: string;
  args: string[];
  options: InheritedSpawnOptions;
}

export interface FakeProcessRunner {
  runner: ProcessRunner;
  calls: SpawnCall[];
}

type CloseChild = (code: number | null, signal?: string | null) => void;

type FailChild = (error: Error) => void;

export interface ControllableProcessRunner extends FakeProcessRunner {
  kills: ForwardedSignal[];
  spawned: Promise<SpawnCall>;
  close: CloseChild;
  fail: FailChild;
}

interface ChildListeners {
  error?: ProcessErrorListener;
  close?: ProcessCloseListener;
}

function createChild(
  listeners: ChildListeners,
  kills: ForwardedSignal[],
): SpawnedProcess {
  return {
    once(
      event: "error" | "close",
      listener: ProcessErrorListener | ProcessCloseListener,
    ) {
      if (event === "error") {
        listeners.error = listener as ProcessErrorListener;
        return undefined;
      }
      listeners.close = listener as ProcessCloseListener;
      return undefined;
    },
    kill(signal: ForwardedSignal) {
      kills.push(signal);
      return true;
    },
  };
}

export function createProcessRunner(
  exitCodes: number[] = [],
): FakeProcessRunner {
  const calls: SpawnCall[] = [];
  const pending = [...exitCodes];
  return {
    calls,
    runner: {
      spawn(executable, args, options) {
        calls.push({ executable, args, options });
        const listeners: ChildListeners = {};
        const exitCode = pending.shift() ?? 0;
        setImmediate(() => listeners.close?.(exitCode, null));
        return createChild(listeners, []);
      },
    },
  };
}

export function createControllableProcessRunner(): ControllableProcessRunner {
  const calls: SpawnCall[] = [];
  const kills: ForwardedSignal[] = [];
  const listeners: ChildListeners = {};
  let announceSpawn: (call: SpawnCall) => void = () => undefined;
  const spawned = new Promise<SpawnCall>((resolve) => {
    announceSpawn = resolve;
  });
  return {
    calls,
    kills,
    spawned,
    close: (code, signal = null) => listeners.close?.(code, signal),
    fail: (error) => listeners.error?.(error),
    runner: {
      spawn(executable, args, options) {
        const call: SpawnCall = { executable, args, options };
        calls.push(call);
        announceSpawn(call);
        return createChild(listeners, kills);
      },
    },
  };
}

export interface FakeSignalTarget extends SignalTarget {
  emit(signal: ForwardedSignal): void;
  listenerCount(signal: ForwardedSignal): number;
}

export function createSignalTarget(): FakeSignalTarget {
  const listeners = new Map<ForwardedSignal, (() => void)[]>();
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

export interface FakeOutput extends CommandOutput {
  infos: string[];
  errors: string[];
}

export function createOutput(): FakeOutput {
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    errors,
    info: (message: string) => infos.push(message),
    error: (message: string) => errors.push(message),
  };
}

export function createPackageReader(
  files: Record<string, string>,
  links: Record<string, string> = {},
): PluginPackageReader {
  return {
    realpath: async (target: string) => links[target] ?? target,
    readFile: async (target: string) => {
      const content = files[target];
      if (content === undefined) {
        throw new Error(`ENOENT: ${target}`);
      }
      return content;
    },
  };
}

export function createGlobalRootResolver(root?: string): GlobalRootResolver {
  return async () => root;
}

export function formatSpawnCalls(calls: SpawnCall[]): string[] {
  return calls.map((call) => [call.executable, ...call.args].join(" "));
}
