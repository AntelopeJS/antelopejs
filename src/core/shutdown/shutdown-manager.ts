import { Logging } from "@antelopejs/interface-core/logging";

import {
  CANCELLED_EXIT_CODE,
  FAILURE_EXIT_CODE,
  SUCCESS_EXIT_CODE,
} from "../cli/exit-codes";

export type ShutdownHandler = () => Promise<void> | void;

export type ProcessSignal = "SIGINT" | "SIGTERM";

/**
 * Where a manager listens for termination signals.
 *
 * `process` itself in production. Tests hand over an emitter of their own:
 * signalling the real process reaches every listener it carries, this
 * manager's and any other's, which makes a signal test indistinguishable
 * from a genuine shutdown of the whole runner.
 */
export interface ProcessSignalSource {
  on(signal: ProcessSignal, listener: () => void): unknown;
  removeListener(signal: ProcessSignal, listener: () => void): unknown;
}

/**
 * Told about a shutdown a termination signal started, so the owner of the
 * process can say it is stopping and clean up what must not outlive it.
 */
export interface SignalShutdownListener {
  /** The first signal arrived: the handlers start. */
  onStopping(signal: ProcessSignal): void;
  /** The handlers are done, or abandoned after the timeout: the process exits next. */
  onStopped(hasTimedOut: boolean): void;
  /** The same signal arrived again: the process exits now, without waiting for the handlers. */
  onForced(signal: ProcessSignal): void;
}

interface RegisteredHandler {
  handler: ShutdownHandler;
  priority: number;
}

interface HandlerRun {
  hasTimedOut: boolean;
  remaining: RegisteredHandler[];
}

const Logger = new Logging.Channel("shutdown");

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10000;
/**
 * The time left to the handlers that follow one still running when the
 * timeout expires: enough to terminate leftover child processes.
 */
export const SHUTDOWN_CLEANUP_TIMEOUT_MS = 3000;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Ctrl+C cancels the run, reported like a shell reports a process
 * interrupted by `SIGINT`. `SIGTERM` is how supervisors ask a service to
 * stop, so a graceful stop on it is a success.
 */
const SIGNAL_EXIT_CODES: Record<ProcessSignal, number> = {
  SIGINT: CANCELLED_EXIT_CODE,
  SIGTERM: SUCCESS_EXIT_CODE,
};

const FORCED_EXIT_CODES: Record<ProcessSignal, number> = {
  SIGINT: CANCELLED_EXIT_CODE,
  SIGTERM: FAILURE_EXIT_CODE,
};

const SILENT_LISTENER: SignalShutdownListener = {
  onStopping: () => undefined,
  onStopped: () => undefined,
  onForced: () => undefined,
};

function settleWithin(
  work: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  return Promise.race([work.then(() => true), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

export class ShutdownManager {
  private handlers: RegisteredHandler[] = [];
  private isShuttingDown = false;
  private shutdownPromise?: Promise<void>;
  private requestedExitCode?: number;
  private sigintHandler?: () => void;
  private sigtermHandler?: () => void;
  private seenSignals = new Set<ProcessSignal>();

  constructor(
    private timeoutMs: number = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    private signalSource: ProcessSignalSource = process,
    private signalListener: SignalShutdownListener = SILENT_LISTENER,
  ) {}

  register(handler: ShutdownHandler, priority: number): void {
    this.handlers.push({ handler, priority });
  }

  unregister(handler: ShutdownHandler): void {
    this.handlers = this.handlers.filter((entry) => entry.handler !== handler);
  }

  shutdown(exitCode?: number): Promise<void> {
    this.updateRequestedExitCode(exitCode);

    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.isShuttingDown = true;
    this.shutdownPromise = this.executeShutdown();
    return this.shutdownPromise;
  }

  get active(): boolean {
    return this.isShuttingDown;
  }

  setupSignalHandlers(): void {
    if (this.sigintHandler || this.sigtermHandler) {
      return;
    }

    this.sigintHandler = () => this.handleSignal("SIGINT");
    this.sigtermHandler = () => this.handleSignal("SIGTERM");

    this.signalSource.on("SIGINT", this.sigintHandler);
    this.signalSource.on("SIGTERM", this.sigtermHandler);
  }

  removeSignalHandlers(): void {
    this.detachSignalHandler("SIGINT", this.sigintHandler);
    this.detachSignalHandler("SIGTERM", this.sigtermHandler);
    this.sigintHandler = undefined;
    this.sigtermHandler = undefined;
  }

  private detachSignalHandler(
    signal: ProcessSignal,
    handler?: () => void,
  ): void {
    if (!handler) {
      return;
    }

    this.signalSource.removeListener(signal, handler);
  }

  private handleSignal(signal: ProcessSignal): void {
    if (this.isShuttingDown) {
      this.handleSignalDuringShutdown(signal);
      return;
    }

    this.seenSignals.add(signal);
    this.signalListener.onStopping(signal);
    void this.shutdown(SIGNAL_EXIT_CODES[signal]);
  }

  private handleSignalDuringShutdown(signal: ProcessSignal): void {
    if (this.seenSignals.has(signal)) {
      Logger.Warn(`Received ${signal} during shutdown. Forcing process exit.`);
      this.signalListener.onForced(signal);
      process.exit(FORCED_EXIT_CODES[signal]);
      return;
    }

    this.seenSignals.add(signal);
    Logger.Info(
      `Received ${signal} during graceful shutdown; ignoring (already shutting down).`,
    );
  }

  private updateRequestedExitCode(exitCode?: number): void {
    if (typeof exitCode !== "number") {
      return;
    }

    if (typeof this.requestedExitCode !== "number") {
      this.requestedExitCode = exitCode;
      return;
    }

    if (
      this.requestedExitCode === SUCCESS_EXIT_CODE &&
      exitCode !== SUCCESS_EXIT_CODE
    ) {
      this.requestedExitCode = exitCode;
    }
  }

  private async executeShutdown(): Promise<void> {
    const hasTimedOut = await this.executeHandlers();

    if (this.seenSignals.size > 0) {
      this.signalListener.onStopped(hasTimedOut);
    }
    if (typeof this.requestedExitCode === "number") {
      process.exit(this.requestedExitCode);
    }
  }

  /**
   * Runs the handlers by descending priority within the timeout. A handler
   * still running when it expires is abandoned, and the ones after it still
   * run within {@link SHUTDOWN_CLEANUP_TIMEOUT_MS}: the last handlers are the
   * cleanup that must happen whatever hangs, such as terminating the child
   * processes left behind.
   *
   * @returns whether the timeout expired.
   */
  private async executeHandlers(): Promise<boolean> {
    const sortedHandlers = [...this.handlers].sort(
      (left, right) => right.priority - left.priority,
    );
    this.handlers = [];

    const run = await this.runHandlersWithin(sortedHandlers, this.timeoutMs);
    if (!run.hasTimedOut) {
      return false;
    }
    Logger.Error(
      `Shutdown timed out after ${this.timeoutMs / MILLISECONDS_PER_SECOND}s, abandoning the handler still running`,
    );
    await this.runHandlersWithin(run.remaining, SHUTDOWN_CLEANUP_TIMEOUT_MS);
    return true;
  }

  private async runHandlersWithin(
    handlers: RegisteredHandler[],
    timeoutMs: number,
  ): Promise<HandlerRun> {
    const deadline = Date.now() + timeoutMs;
    for (const [index, { handler }] of handlers.entries()) {
      const hasSettled = await settleWithin(
        this.runHandler(handler),
        deadline - Date.now(),
      );
      if (!hasSettled) {
        return { hasTimedOut: true, remaining: handlers.slice(index + 1) };
      }
    }
    return { hasTimedOut: false, remaining: [] };
  }

  private async runHandler(handler: ShutdownHandler): Promise<void> {
    try {
      await handler();
    } catch (error) {
      Logger.Error("Shutdown handler error:", error);
    }
  }
}
