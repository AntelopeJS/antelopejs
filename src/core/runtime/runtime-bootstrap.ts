import EventEmitter from 'events';
import path from 'path';
import { LoadedConfig, ConfigLoader } from '../config/config-loader';
import { NodeFileSystem } from '../filesystem';
import { LaunchOptions } from '../../types';
import { addChannelFilter, setupAntelopeProjectLogging } from '../../logging';
import { BuildOptions, NormalizedLoadedConfig, ProjectRuntimeConfig } from './runtime-types';
import { Logging } from '../../interfaces/logging/beta';

const EXIT_CODE_ERROR = 1;
const DEFAULT_MAX_EVENT_LISTENERS = 50;
let processHandlersReady = false;

export function setupProcessHandlers(): void {
  if (processHandlersReady) {
    return;
  }

  processHandlersReady = true;
  process.on('uncaughtException', (error: Error) => {
    Logging.Error('Uncaught exception:', error.message);
    if (error.stack) {
      Logging.Error(error.stack);
    }
    process.exit(EXIT_CODE_ERROR);
  });

  process.on('unhandledRejection', (reason: any) => {
    Logging.Error('Unhandled rejection:', reason);
    if (reason instanceof AggregateError && reason.errors) {
      reason.errors.forEach((err: unknown) => Logging.Error('  -', err));
    }
    process.exit(EXIT_CODE_ERROR);
  });

  process.on('warning', (warning: Error) => {
    Logging.Warn('Warning:', warning.message);
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
): Promise<ProjectRuntimeConfig> {
  setupProcessHandlers();

  const fs = new NodeFileSystem();
  const loader = new ConfigLoader(fs);
  const loadedConfig = await loader.load(projectFolder, env);
  const normalizedConfig = normalizeLoadedConfig(loadedConfig, projectFolder);

  setupAntelopeProjectLogging(loadedConfig.logging);
  applyVerboseChannels(options.verbose);

  return { fs, normalizedConfig };
}
