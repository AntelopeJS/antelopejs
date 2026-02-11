import EventEmitter from 'events';
import path from 'path';
import { LoadedConfig, ConfigLoader } from '../config/config-loader';
import { NodeFileSystem } from '../filesystem';
import { LaunchOptions } from '../../types';
import { addChannelFilter, setupAntelopeProjectLogging } from '../../logging';
import { BuildOptions, NormalizedLoadedConfig, ProjectRuntimeConfig } from './runtime-types';
import { Logging } from '../../interfaces/logging/beta';
import { ShutdownManager } from '../shutdown';

const EXIT_CODE_ERROR = 1;
const DEFAULT_MAX_EVENT_LISTENERS = 50;
let processHandlersReady = false;
let activeShutdownManager: ShutdownManager | undefined;

function shutdownProcess(exitCode: number): void {
  if (activeShutdownManager) {
    void activeShutdownManager.shutdown(exitCode);
    return;
  }

  process.exit(exitCode);
}

export function setupProcessHandlers(shutdownManager?: ShutdownManager): void {
  if (shutdownManager) {
    activeShutdownManager = shutdownManager;
  }

  if (processHandlersReady) {
    return;
  }

  processHandlersReady = true;
  process.on('uncaughtException', (error: Error) => {
    Logging.Error('Uncaught exception:', error);
    shutdownProcess(EXIT_CODE_ERROR);
  });

  process.on('unhandledRejection', (reason: any) => {
    Logging.Error('Unhandled rejection:', reason);
    if (reason instanceof AggregateError && reason.errors) {
      reason.errors.forEach((err: unknown) => Logging.Error('  -', err));
    }
    shutdownProcess(EXIT_CODE_ERROR);
  });

  process.on('warning', (warning: Error) => {
    Logging.Warn('Warning:', warning);
  });
}

export async function withRaisedMaxListeners<T>(task: () => Promise<T>): Promise<T> {
  const originalMaxListeners = EventEmitter.defaultMaxListeners;
  EventEmitter.defaultMaxListeners = Math.max(originalMaxListeners, DEFAULT_MAX_EVENT_LISTENERS);

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

  verbose.forEach((channel) => addChannelFilter(channel, 0));
}

export function normalizeLoadedConfig(loadedConfig: LoadedConfig, projectFolder: string): NormalizedLoadedConfig {
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

export async function loadProjectRuntimeConfig(
  projectFolder: string,
  env: string,
  options: BuildOptions | LaunchOptions,
  shutdownManager?: ShutdownManager,
): Promise<ProjectRuntimeConfig> {
  setupProcessHandlers(shutdownManager);

  const fs = new NodeFileSystem();
  const loader = new ConfigLoader(fs);
  const loadedConfig = await loader.load(projectFolder, env);
  const normalizedConfig = normalizeLoadedConfig(loadedConfig, projectFolder);

  setupAntelopeProjectLogging(loadedConfig.logging);
  applyVerboseChannels(options.verbose);

  return { fs, normalizedConfig };
}
