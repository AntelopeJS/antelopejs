import path from "node:path";
import EventEmitter from "node:events";
import { Logging } from "@antelopejs/interface-core/logging";
import { MODULE_CONTEXT_INVALIDATED_CODE } from "@antelopejs/interface-core";

import { NodeFileSystem } from "../filesystem";
import type { LaunchOptions } from "../../types";
import type { ShutdownManager } from "../shutdown";
import { ConfigLoader, type LoadedConfig } from "../config/config-loader";
import { addChannelFilter, setupAntelopeProjectLogging } from "../../logging";
import type {
  BuildOptions,
  NormalizedLoadedConfig,
  ProjectRuntimeConfig,
} from "./runtime-types";

const EXIT_CODE_ERROR = 1;
const DEFAULT_MAX_EVENT_LISTENERS = 50;
let processHandlersReady = false;
let invalidatedWorkTolerance = 0;
const shutdownManagers: ShutdownManager[] = [];

function shutdownProcess(exitCode: number): void {
  const activeShutdownManager = shutdownManagers.at(-1);
  if (activeShutdownManager) {
    void activeShutdownManager.shutdown(exitCode);
    return;
  }

  process.exit(exitCode);
}

function isInvalidatedModuleWork(reason: unknown): boolean {
  return (
    invalidatedWorkTolerance > 0 &&
    reason instanceof Error &&
    "code" in reason &&
    reason.code === MODULE_CONTEXT_INVALIDATED_CODE
  );
}

/**
 * Reports a failure of work left behind by a destroyed module generation
 * without shutting the process down, when that is tolerated.
 */
function reportInvalidatedModuleWork(kind: string, reason: unknown): boolean {
  if (!isInvalidatedModuleWork(reason)) {
    return false;
  }
  Logging.Error(
    `${kind} in work of a destroyed module generation; the process keeps running:`,
    reason,
  );
  return true;
}

/**
 * Keeps the process running when work left behind by a destroyed module
 * generation fails, for as long as modules are hot reloaded.
 *
 * A reload destroys the previous generation of a module, and the replacement
 * when it fails to construct or start. Asynchronous work either one left
 * pending then fails with `ModuleContextInvalidatedError` when it resumes: that
 * failure is what invalidation is for, and it is still reported, but it must
 * not take the dev process down with it. The module stays reloadable on its
 * next change. Any other uncaught failure still shuts the process down.
 *
 * @returns A function that withdraws this tolerance.
 */
export function tolerateInvalidatedModuleWork(): () => void {
  invalidatedWorkTolerance += 1;
  let isWithdrawn = false;
  return () => {
    if (isWithdrawn) {
      return;
    }
    isWithdrawn = true;
    invalidatedWorkTolerance -= 1;
  };
}

export function setupProcessHandlers(shutdownManager?: ShutdownManager): void {
  if (shutdownManager) {
    releaseProcessShutdownManager(shutdownManager);
    shutdownManagers.push(shutdownManager);
  }

  if (processHandlersReady) {
    return;
  }

  processHandlersReady = true;
  process.on("uncaughtException", (error: Error) => {
    if (reportInvalidatedModuleWork("Uncaught exception", error)) {
      return;
    }
    Logging.Error("Uncaught exception:", error);
    shutdownProcess(EXIT_CODE_ERROR);
  });

  process.on("unhandledRejection", (reason: any) => {
    if (reportInvalidatedModuleWork("Unhandled rejection", reason)) {
      return;
    }
    Logging.Error("Unhandled rejection:", reason);
    shutdownProcess(EXIT_CODE_ERROR);
  });

  process.on("warning", (warning: Error) => {
    Logging.Warn("Warning:", warning);
  });
}

export function releaseProcessShutdownManager(
  shutdownManager: ShutdownManager,
): void {
  const index = shutdownManagers.indexOf(shutdownManager);
  if (index !== -1) {
    shutdownManagers.splice(index, 1);
  }
}

export async function withRaisedMaxListeners<T>(
  task: () => Promise<T>,
): Promise<T> {
  const originalMaxListeners = EventEmitter.defaultMaxListeners;
  EventEmitter.defaultMaxListeners = Math.max(
    originalMaxListeners,
    DEFAULT_MAX_EVENT_LISTENERS,
  );

  try {
    return await task();
  } finally {
    EventEmitter.defaultMaxListeners = originalMaxListeners;
  }
}

export function applyVerboseChannels(verbose?: string[]): void {
  if (!verbose) {
    return;
  }

  for (const channel of verbose) {
    addChannelFilter(channel, 0);
  }
}

export function normalizeLoadedConfig(
  loadedConfig: LoadedConfig,
  projectFolder: string,
): NormalizedLoadedConfig {
  const absoluteCache = path.isAbsolute(loadedConfig.cacheFolder)
    ? loadedConfig.cacheFolder
    : path.join(projectFolder, loadedConfig.cacheFolder);

  return {
    ...loadedConfig,
    modules: loadedConfig.modules ?? {},
    cacheFolder: absoluteCache,
    projectFolder: path.resolve(projectFolder),
  };
}

/**
 * Load and normalize a project's configuration without applying any process
 * level side effects, so callers stay in control of ordering.
 */
export async function loadProjectConfig(
  projectFolder: string,
  env: string,
): Promise<ProjectRuntimeConfig> {
  const fs = new NodeFileSystem();
  const loader = new ConfigLoader(fs);
  const loadedConfig = await loader.load(projectFolder, env);

  return {
    fs,
    normalizedConfig: normalizeLoadedConfig(loadedConfig, projectFolder),
  };
}

export async function loadProjectRuntimeConfig(
  projectFolder: string,
  env: string,
  options: BuildOptions | LaunchOptions,
  shutdownManager?: ShutdownManager,
): Promise<ProjectRuntimeConfig> {
  setupProcessHandlers(shutdownManager);

  const config = await loadProjectConfig(projectFolder, env);

  setupAntelopeProjectLogging(config.normalizedConfig.logging);
  applyVerboseChannels(options.verbose);

  return config;
}
