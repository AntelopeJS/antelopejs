import { Logging } from '../../interfaces/logging/beta';

export type ShutdownHandler = () => Promise<void> | void;

type ProcessSignal = 'SIGINT' | 'SIGTERM';

interface RegisteredHandler {
  handler: ShutdownHandler;
  priority: number;
}

const Logger = new Logging.Channel('shutdown');

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10000;
const EXIT_CODE_SUCCESS = 0;
const FORCE_EXIT_CODE = 1;

export class ShutdownManager {
  private handlers: RegisteredHandler[] = [];
  private isShuttingDown = false;
  private shutdownPromise?: Promise<void>;
  private requestedExitCode?: number;
  private sigintHandler?: () => void;
  private sigtermHandler?: () => void;

  constructor(private timeoutMs: number = DEFAULT_SHUTDOWN_TIMEOUT_MS) {}

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

    this.sigintHandler = () => this.handleSignal('SIGINT');
    this.sigtermHandler = () => this.handleSignal('SIGTERM');

    process.on('SIGINT', this.sigintHandler);
    process.on('SIGTERM', this.sigtermHandler);
  }

  removeSignalHandlers(): void {
    this.detachSignalHandler('SIGINT', this.sigintHandler);
    this.detachSignalHandler('SIGTERM', this.sigtermHandler);
    this.sigintHandler = undefined;
    this.sigtermHandler = undefined;
  }

  private detachSignalHandler(signal: ProcessSignal, handler?: () => void): void {
    if (!handler) {
      return;
    }

    process.removeListener(signal, handler);
  }

  private handleSignal(signal: ProcessSignal): void {
    if (this.isShuttingDown) {
      Logger.Warn(`Received ${signal} during shutdown. Forcing process exit.`);
      process.exit(FORCE_EXIT_CODE);
      return;
    }

    void this.shutdown(EXIT_CODE_SUCCESS);
  }

  private updateRequestedExitCode(exitCode?: number): void {
    if (typeof exitCode !== 'number') {
      return;
    }

    if (typeof this.requestedExitCode !== 'number') {
      this.requestedExitCode = exitCode;
      return;
    }

    if (this.requestedExitCode === EXIT_CODE_SUCCESS && exitCode !== EXIT_CODE_SUCCESS) {
      this.requestedExitCode = exitCode;
    }
  }

  private async executeShutdown(): Promise<void> {
    await this.runHandlersWithTimeout();

    if (typeof this.requestedExitCode === 'number') {
      process.exit(this.requestedExitCode);
    }
  }

  private runHandlersWithTimeout(): Promise<void> {
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        Logger.Error('Shutdown timed out, forcing completion');
        resolve();
      }, this.timeoutMs);
    });

    return Promise.race([this.executeHandlers(), timeoutPromise]);
  }

  private async executeHandlers(): Promise<void> {
    const sortedHandlers = [...this.handlers].sort((left, right) => right.priority - left.priority);

    for (const { handler } of sortedHandlers) {
      try {
        await handler();
      } catch (error) {
        Logger.Error('Shutdown handler error:', error);
      }
    }
  }
}
