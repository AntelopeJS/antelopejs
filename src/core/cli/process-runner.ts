import { constants } from "node:os";
import { spawn } from "node:child_process";

import { requiresShell } from "./global-package-manager";
import { FAILURE_EXIT_CODE, SIGNAL_EXIT_CODE_OFFSET } from "./exit-codes";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const SIGNAL_NUMBERS: Record<string, number> = constants.signals;

export type ForwardedSignal = (typeof FORWARDED_SIGNALS)[number];

export type ProcessCloseListener = (
  code: number | null,
  signal: string | null,
) => void;

export type ProcessErrorListener = (error: Error) => void;

export interface SpawnedProcess {
  once(event: "error", listener: ProcessErrorListener): unknown;
  once(event: "close", listener: ProcessCloseListener): unknown;
  kill(signal: ForwardedSignal): unknown;
}

export interface InheritedSpawnOptions {
  stdio: "inherit";
  shell?: boolean;
}

export interface ProcessRunner {
  spawn(
    executable: string,
    args: string[],
    options: InheritedSpawnOptions,
  ): SpawnedProcess;
}

export interface SignalTarget {
  on(signal: ForwardedSignal, listener: () => void): unknown;
  off(signal: ForwardedSignal, listener: () => void): unknown;
}

export interface InheritedProcessOptions {
  processRunner?: ProcessRunner;
  signalTarget?: SignalTarget;
  platform?: NodeJS.Platform;
}

interface SignalForwarder {
  signal: ForwardedSignal;
  handler: () => void;
}

const nodeProcessRunner: ProcessRunner = { spawn };

function exitCodeFromSignal(signal: string): number {
  const signalNumber = SIGNAL_NUMBERS[signal];
  return signalNumber
    ? SIGNAL_EXIT_CODE_OFFSET + signalNumber
    : FAILURE_EXIT_CODE;
}

function exitCodeFromClose(code: number | null, signal: string | null): number {
  if (code !== null) {
    return code;
  }
  return signal ? exitCodeFromSignal(signal) : FAILURE_EXIT_CODE;
}

function forwardSignals(
  child: SpawnedProcess,
  signalTarget: SignalTarget,
): () => void {
  const forwarders: SignalForwarder[] = FORWARDED_SIGNALS.map((signal) => ({
    signal,
    handler: () => child.kill(signal),
  }));
  forwarders.forEach(({ signal, handler }) => signalTarget.on(signal, handler));
  return () =>
    forwarders.forEach(({ signal, handler }) =>
      signalTarget.off(signal, handler),
    );
}

function waitForExit(
  child: SpawnedProcess,
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
  options: InheritedProcessOptions = {},
): Promise<number> {
  const processRunner = options.processRunner ?? nodeProcessRunner;
  const spawnOptions: InheritedSpawnOptions = { stdio: "inherit" };
  if (requiresShell(executable, options.platform ?? process.platform)) {
    spawnOptions.shell = true;
  }
  const child = processRunner.spawn(executable, args, spawnOptions);
  return waitForExit(child, options.signalTarget ?? process);
}
