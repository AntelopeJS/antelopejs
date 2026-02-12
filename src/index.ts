import { Logging } from './interfaces/logging/beta';
import { Writable } from 'stream';
import { ModuleManager } from './core/module-manager';
import { NodeFileSystem } from './core/filesystem';
import { LaunchOptions } from './types';
import { setupAntelopeProjectLogging } from './logging';
import { FileWatcher } from './core/watch/file-watcher';
import { HotReload } from './core/watch/hot-reload';
import { DEFAULT_ENV } from './core/config/config-paths';
import { ReplSession } from './core/repl/repl-session';
import { ShutdownManager } from './core/shutdown';
import {
  createLoaderContext,
  constructAndStartModules,
  ensureGraphIsValid,
  getWatchDirs,
  loadModuleEntriesForManager,
  registerCoreInterfaces,
  reloadWatchedModule,
} from './core/runtime/module-loading';
import {
  applyVerboseChannels,
  loadProjectRuntimeConfig,
  setupProcessHandlers,
  withRaisedMaxListeners,
} from './core/runtime/runtime-bootstrap';
import {
  ensureBuildModulesExist,
  mapArtifactModuleEntries,
  readBuildArtifactOrThrow,
  warnIfBuildIsStale,
  writeProjectBuildArtifact,
} from './core/runtime/build-runtime';
import { BuildOptions, LoaderContext } from './core/runtime/runtime-types';

export { ModuleManager } from './core/module-manager';
export { Module } from './core/module';
export { ModuleManifest } from './core/module-manifest';
export { ConfigLoader } from './core/config/config-loader';
export { DEFAULT_ENV } from './core/config/config-paths';
export { DownloaderRegistry } from './core/downloaders/registry';
export { ModuleCache } from './core/module-cache';
export { LaunchOptions } from './types';
export { TestModule } from './core/test/test-module';
export type { BuildOptions } from './core/runtime/runtime-types';

const Logger = new Logging.Channel('loader');

const MAX_STREAM_LISTENERS = 20;
const INTERACTIVE_PROMPT = '> ';
const SHUTDOWN_PRIORITY_MODULES = 30;
const SHUTDOWN_PRIORITY_RESOURCES = 20;
const SHUTDOWN_PRIORITY_CLEANUP = 10;

Writable.prototype.setMaxListeners(MAX_STREAM_LISTENERS);

interface CoreInitialization {
  manager: ModuleManager;
  fs: NodeFileSystem;
  shutdownManager: ShutdownManager;
  loaderContext: LoaderContext;
}

let activeShutdownManager: ShutdownManager | undefined;

function setActiveShutdownManager(shutdownManager: ShutdownManager): void {
  activeShutdownManager?.removeSignalHandlers();
  activeShutdownManager = shutdownManager;
  shutdownManager.setupSignalHandlers();
}

function registerModuleShutdownHandler(shutdownManager: ShutdownManager, manager: ModuleManager): void {
  shutdownManager.register(async () => {
    await manager.stopAll();
    await manager.destroyAll();
  }, SHUTDOWN_PRIORITY_MODULES);
}

function registerShutdownCleanup(shutdownManager: ShutdownManager): void {
  shutdownManager.register(async () => {
    shutdownManager.removeSignalHandlers();
    if (activeShutdownManager === shutdownManager) {
      activeShutdownManager = undefined;
    }
  }, SHUTDOWN_PRIORITY_CLEANUP);
}

async function setupPostLaunchFeatures(
  manager: ModuleManager,
  fs: NodeFileSystem,
  options: LaunchOptions,
  shutdownManager: ShutdownManager,
  loaderContext: LoaderContext,
): Promise<void> {
  registerModuleShutdownHandler(shutdownManager, manager);
  registerShutdownCleanup(shutdownManager);

  if (options.watch) {
    const watcher = new FileWatcher(fs);
    const hotReload = new HotReload(async (moduleId) => reloadWatchedModule(manager, moduleId, loaderContext));

    for (const { module } of manager.getLoadedModules()) {
      if (module.manifest?.source?.type === 'local') {
        const watchDirs = getWatchDirs(module.manifest.source);
        await watcher.scanModule(module.id, module.manifest.folder, watchDirs);
      }
    }

    watcher.onModuleChanged((id) => hotReload.queue(id));
    watcher.startWatching();

    shutdownManager.register(async () => {
      hotReload.clear();
      watcher.stopWatching();
    }, SHUTDOWN_PRIORITY_RESOURCES);
  }

  if (options.interactive) {
    const repl = new ReplSession({ moduleManager: manager });
    repl.start(INTERACTIVE_PROMPT);

    shutdownManager.register(async () => {
      repl.close();
    }, SHUTDOWN_PRIORITY_RESOURCES);
  }

  setActiveShutdownManager(shutdownManager);
}

async function initializeCore(projectFolder: string, env: string, options: LaunchOptions): Promise<CoreInitialization> {
  const shutdownManager = new ShutdownManager();
  const runtimeConfig = await loadProjectRuntimeConfig(projectFolder, env, options, shutdownManager);
  const loaderContext = await createLoaderContext(runtimeConfig.normalizedConfig);

  const manager = await withRaisedMaxListeners(async () => {
    const moduleManager = new ModuleManager();
    await loadModuleEntriesForManager(moduleManager, runtimeConfig.normalizedConfig, true, loaderContext);
    await constructAndStartModules(moduleManager);
    return moduleManager;
  });

  return {
    manager,
    fs: runtimeConfig.fs,
    shutdownManager,
    loaderContext,
  };
}

export async function launch(
  projectFolder: string = '.',
  env: string = DEFAULT_ENV,
  options: LaunchOptions = {},
): Promise<ModuleManager> {
  const initialized = await initializeCore(projectFolder, env, options);
  await setupPostLaunchFeatures(
    initialized.manager,
    initialized.fs,
    options,
    initialized.shutdownManager,
    initialized.loaderContext,
  );
  return initialized.manager;
}

export async function build(
  projectFolder: string = '.',
  env: string = DEFAULT_ENV,
  options: BuildOptions = {},
): Promise<void> {
  const runtimeConfig = await loadProjectRuntimeConfig(projectFolder, env, options);

  await withRaisedMaxListeners(async () => {
    const manager = new ModuleManager();
    const entries = await loadModuleEntriesForManager(manager, runtimeConfig.normalizedConfig, false);
    ensureGraphIsValid(manager);
    await writeProjectBuildArtifact(runtimeConfig.normalizedConfig, env, entries, runtimeConfig.fs);
  });
}

function logEnvironmentMismatch(startEnv: string, buildEnv: string): void {
  if (startEnv === buildEnv) {
    return;
  }
  Logger.Info(`Starting build created for environment '${buildEnv}' with runtime env '${startEnv}'`);
}

async function buildManagerFromArtifact(
  manager: ModuleManager,
  artifactEntries: ReturnType<typeof mapArtifactModuleEntries>,
): Promise<void> {
  const coreManifest = await registerCoreInterfaces(manager);
  await coreManifest.loadExports();

  manager.addModules(artifactEntries);
  ensureGraphIsValid(manager);
  await constructAndStartModules(manager);
}

export async function launchFromBuild(
  projectFolder: string = '.',
  env: string = DEFAULT_ENV,
  options: LaunchOptions = {},
): Promise<ModuleManager> {
  const shutdownManager = new ShutdownManager();
  setupProcessHandlers(shutdownManager);
  const fs = new NodeFileSystem();
  const artifact = await readBuildArtifactOrThrow(projectFolder, fs);

  setupAntelopeProjectLogging(artifact.config.logging);
  applyVerboseChannels(options.verbose);

  const startEnv = env || DEFAULT_ENV;
  logEnvironmentMismatch(startEnv, artifact.env);

  await warnIfBuildIsStale(projectFolder, artifact, fs);
  await ensureBuildModulesExist(artifact, fs);

  const manager = await withRaisedMaxListeners(async () => {
    const moduleManager = new ModuleManager();
    const artifactEntries = mapArtifactModuleEntries(artifact);
    await buildManagerFromArtifact(moduleManager, artifactEntries);
    return moduleManager;
  });

  registerModuleShutdownHandler(shutdownManager, manager);
  registerShutdownCleanup(shutdownManager);
  setActiveShutdownManager(shutdownManager);
  return manager;
}

export default launch;
