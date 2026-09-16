import { constants } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

const DEFAULT_FAILURE_EXIT_CODE = 1;
const SIGNAL_EXIT_CODE_OFFSET = 128;
const FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

export interface ProcessRunner {
  spawn: typeof spawn;
}

export interface SignalTarget {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

export const nodeProcessRunner: ProcessRunner = { spawn };

function exitCodeFromSignal(signal: NodeJS.Signals): number {
  const signalNumber = constants.signals[signal];
  return signalNumber
    ? SIGNAL_EXIT_CODE_OFFSET + signalNumber
    : DEFAULT_FAILURE_EXIT_CODE;
}

function exitCodeFromClose(
  code: number | null,
  signal: NodeJS.Signals | null,
): number {
  if (code !== null) {
    return code;
  }
  return signal ? exitCodeFromSignal(signal) : DEFAULT_FAILURE_EXIT_CODE;
}

function forwardSignals(
  child: ChildProcess,
  signalTarget: SignalTarget,
): () => void {
  const handlers = FORWARDED_SIGNALS.map(
    (signal): [NodeJS.Signals, () => void] => [
      signal,
      () => child.kill(signal),
    ],
  );
  handlers.forEach(([signal, handler]) => signalTarget.on(signal, handler));
  return () =>
    handlers.forEach(([signal, handler]) => signalTarget.off(signal, handler));
}

function waitForExit(
  child: ChildProcess,
  signalTarget: SignalTarget,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const stopForwarding = forwardSignals(child, signalTarget);
    child.once("error", (error) => {
      stopForwarding();
      reject(error);
    });
    child.once("close", (code, signal) => {
      stopForwarding();
      resolve(exitCodeFromClose(code, signal));
    });
  });
}

export async function runInheritedProcess(
  executable: string,
  args: string[],
  processRunner: ProcessRunner = nodeProcessRunner,
  signalTarget: SignalTarget = process,
): Promise<number> {
  const child = processRunner.spawn(executable, args, { stdio: "inherit" });
  return waitForExit(child, signalTarget);
}
