import { Logging } from "@antelopejs/interface-core/logging";

import type { ModuleManager } from "../module-manager";
import type { TaskHandle } from "../cli/output/types";
import { getProcessTasks } from "../cli/output/tasks";
import type { RuntimePolicy } from "./runtime-policy";
import { releaseProcessShutdownManager } from "./runtime-bootstrap";
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  killProcessTree,
  type ProcessSignal,
  type ShutdownHandler,
  ShutdownManager,
  type SignalShutdownListener,
  terminateProcessTree,
} from "../shutdown";

const Logger = new Logging.Channel("loader");

const SHUTDOWN_PRIORITY_MODULES = 30;
const SHUTDOWN_PRIORITY_CHILD_PROCESSES = 15;
const SHUTDOWN_PRIORITY_CLEANUP = 10;
const STOPPING_LABELS: Record<ProcessSignal, string> = {
  SIGINT: "Stopping the project (Ctrl+C again to force)",
  SIGTERM: "Stopping the project",
};
const STOPPED_LABEL = "Stopped the project";
const TIMED_OUT_LABEL = "Stopped the project after the shutdown timed out";
const FORCED_LABEL = "Stopped the project without waiting for its shutdown";

const activeShutdownManagers: ShutdownManager[] = [];

/** The shutdown manager that currently answers `SIGINT` and `SIGTERM`. */
export function getActiveShutdownManager(): ShutdownManager | undefined {
  return activeShutdownManagers.at(-1);
}

function setActiveShutdownManager(shutdownManager: ShutdownManager): void {
  releaseActiveShutdownManager(shutdownManager);
  activeShutdownManagers.at(-1)?.removeSignalHandlers();
  activeShutdownManagers.push(shutdownManager);
  shutdownManager.setupSignalHandlers();
}

function releaseActiveShutdownManager(shutdownManager: ShutdownManager): void {
  const index = activeShutdownManagers.indexOf(shutdownManager);
  if (index === -1) {
    return;
  }
  const wasActive = index === activeShutdownManagers.length - 1;
  activeShutdownManagers.splice(index, 1);
  shutdownManager.removeSignalHandlers();
  if (wasActive) {
    activeShutdownManagers.at(-1)?.setupSignalHandlers();
  }
}

/**
 * Says on the terminal that the project is stopping, then how it stopped,
 * and kills the child processes at once when a second signal forces the
 * exit.
 */
function createStopListener(isReported: boolean): SignalShutdownListener {
  let task: TaskHandle | undefined;
  return {
    onStopping: (signal) => {
      task = isReported
        ? getProcessTasks().start(STOPPING_LABELS[signal])
        : undefined;
    },
    onStopped: (hasTimedOut) => {
      if (hasTimedOut) {
        task?.warn(TIMED_OUT_LABEL);
        return;
      }
      task?.succeed(STOPPED_LABEL);
    },
    onForced: () => {
      killProcessTree();
      task?.warn(FORCED_LABEL);
    },
  };
}

export function createShutdownManager(policy: RuntimePolicy): ShutdownManager {
  return new ShutdownManager(
    DEFAULT_SHUTDOWN_TIMEOUT_MS,
    process,
    createStopListener(policy.terminal),
  );
}

async function shutdownModules(manager: ModuleManager): Promise<void> {
  const errors: unknown[] = [];
  try {
    await manager.stopAll();
  } catch (error) {
    errors.push(error);
  }
  try {
    await manager.destroyAll();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Shutdown failed");
  }
}

/**
 * Stops and destroys the modules on shutdown.
 *
 * @returns the handler, to withdraw when a failed launch tears the modules
 * down itself.
 */
export function registerModuleShutdownHandler(
  shutdownManager: ShutdownManager,
  manager: ModuleManager,
): ShutdownHandler {
  const handler = () => shutdownModules(manager);
  shutdownManager.register(handler, SHUTDOWN_PRIORITY_MODULES);
  return handler;
}

/**
 * Kills the processes modules spawned and did not reap themselves.
 *
 * Registered after the module handlers so modules keep the chance to stop their
 * own children gracefully; whatever is left would otherwise be reparented to
 * init and survive the process.
 */
function registerChildProcessCleanup(shutdownManager: ShutdownManager): void {
  shutdownManager.register(async () => {
    const terminated = await terminateProcessTree();
    if (terminated.length > 0) {
      Logger.Debug(
        `Terminated ${terminated.length} leftover child process(es): ${terminated.join(", ")}`,
      );
    }
  }, SHUTDOWN_PRIORITY_CHILD_PROCESSES);
}

/**
 * Takes the process over for the project as soon as its launch starts:
 * `SIGINT` and `SIGTERM` stop it, whether its modules are still loading or
 * already running, and the child processes left behind are terminated.
 */
export function claimProcess(
  shutdownManager: ShutdownManager,
  policy: RuntimePolicy,
): void {
  if (policy.signals) {
    registerChildProcessCleanup(shutdownManager);
  }
  shutdownManager.register(async () => {
    releaseActiveShutdownManager(shutdownManager);
    releaseProcessShutdownManager(shutdownManager);
  }, SHUTDOWN_PRIORITY_CLEANUP);
  if (policy.signals) {
    setActiveShutdownManager(shutdownManager);
  }
}
