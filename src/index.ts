import { Writable } from "node:stream";
import { Logging } from "@antelopejs/interface-core/logging";
import { DEFAULT_ENV, tryFindConfigPath } from "./core/config/config-paths";
import type { NodeFileSystem } from "./core/filesystem";
import { ModuleManager } from "./core/module-manager";
import { ReplSession } from "./core/repl/repl-session";
import { writeProjectBuildArtifact } from "./core/runtime/build-runtime";
import {
  prepareFromArtifact,
  prepareFromConfig,
  runLaunchSequence,
} from "./core/runtime/launch-sequence";
import {
  ensureGraphIsValid,
  getWatchDirs,
  loadModuleEntriesForManager,
  reloadWatchedModule,
} from "./core/runtime/module-loading";
import {
  loadProjectRuntimeConfig,
  releaseProcessShutdownManager,
  withRaisedMaxListeners,
} from "./core/runtime/runtime-bootstrap";
import type {
  BuildOptions,
  LoaderContext,
  ProjectPreparer,
  StartedProject,
} from "./core/runtime/runtime-types";
import type { ShutdownManager } from "./core/shutdown";
import {
  checkOutdatedModules,
  warnOutdatedModules,
} from "./core/version-checker";
import { FileWatcher } from "./core/watch/file-watcher";
import { HotReload } from "./core/watch/hot-reload";
import type { LaunchOptions } from "./types";

export { ConfigLoader } from "./core/config/config-loader";
export { DEFAULT_ENV } from "./core/config/config-paths";
export { DownloaderRegistry } from "./core/downloaders/registry";
export { Module } from "./core/module";
export { ModuleCache } from "./core/module-cache";
export { ModuleManager } from "./core/module-manager";
export { ModuleManifest } from "./core/module-manifest";
export type { BuildOptions } from "./core/runtime/runtime-types";
export { TestModule } from "./core/test/test-module";
export { LaunchOptions } from "./types";

const Logger = new Logging.Channel("loader");

const MAX_STREAM_LISTENERS = 20;
const INTERACTIVE_PROMPT = "> ";
const SHUTDOWN_PRIORITY_MODULES = 30;
const SHUTDOWN_PRIORITY_RESOURCES = 20;
const SHUTDOWN_PRIORITY_CLEANUP = 10;
const UNSUPPORTED_ARTIFACT_OPTIONS_WARNING =
  "Watch and interactive modes are only available when launching from configuration; ignoring them for this build artifact launch.";

Writable.prototype.setMaxListeners(MAX_STREAM_LISTENERS);

const activeShutdownManagers: ShutdownManager[] = [];

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

function registerModuleShutdownHandler(
  shutdownManager: ShutdownManager,
  manager: ModuleManager,
): void {
  shutdownManager.register(async () => {
    await manager.stopAll();
    await manager.destroyAll();
  }, SHUTDOWN_PRIORITY_MODULES);
}

function registerShutdownCleanup(shutdownManager: ShutdownManager): void {
  shutdownManager.register(async () => {
    releaseActiveShutdownManager(shutdownManager);
    releaseProcessShutdownManager(shutdownManager);
  }, SHUTDOWN_PRIORITY_CLEANUP);
}

async function setupWatching(
  manager: ModuleManager,
  fs: NodeFileSystem,
  projectFolder: string,
  env: string,
  options: LaunchOptions,
  shutdownManager: ShutdownManager,
  loaderContext: LoaderContext,
): Promise<void> {
  const watcher = new FileWatcher(fs);
  const loadedSignatures = new Map<string, string>();
  const hotReload = new HotReload(async (moduleId) => {
    const signature = watcher.getModuleSignature(moduleId);
    if (loadedSignatures.get(moduleId) === signature) {
      return;
    }
    await reloadWatchedModule(manager, moduleId, loaderContext);
    loadedSignatures.set(moduleId, signature);
  });

  shutdownManager.register(async () => {
    hotReload.clear();
    watcher.stopWatching();
  }, SHUTDOWN_PRIORITY_RESOURCES);

  for (const { module } of manager.getLoadedModules()) {
    if (module.manifest?.source?.type === "local") {
      const watchDirs = getWatchDirs(module.manifest.source);
      await watcher.scanModule(module.id, module.manifest.folder, watchDirs);
      loadedSignatures.set(module.id, watcher.getModuleSignature(module.id));
    }
  }

  const configPath = await tryFindConfigPath(projectFolder, fs);
  if (configPath) {
    await watcher.watchFile(configPath, () => {
      Logger.Info("Configuration file changed, restarting project...");
      void restartProject(projectFolder, env, options);
    });
  }

  watcher.onModuleChanged((id) => hotReload.queue(id));
  watcher.startWatching();
}

async function setupPostLaunchFeatures(
  started: StartedProject,
  projectFolder: string,
  env: string,
  options: LaunchOptions,
): Promise<void> {
  const { manager, shutdownManager } = started;

  registerModuleShutdownHandler(shutdownManager, manager);
  registerShutdownCleanup(shutdownManager);

  if (!started.dev && (options.watch || options.interactive)) {
    Logger.Warn(UNSUPPORTED_ARTIFACT_OPTIONS_WARNING);
  }

  if (started.dev && options.watch) {
    await setupWatching(
      manager,
      started.fs,
      projectFolder,
      env,
      options,
      shutdownManager,
      await started.loadContext(),
    );
  }

  if (started.dev && options.interactive) {
    const repl = new ReplSession({ moduleManager: manager });
    shutdownManager.register(async () => {
      repl.close();
    }, SHUTDOWN_PRIORITY_RESOURCES);
    repl.start(INTERACTIVE_PROMPT);
  }

  setActiveShutdownManager(shutdownManager);
}

async function startProject(
  prepare: ProjectPreparer,
  projectFolder: string,
  env: string,
  options: LaunchOptions,
): Promise<ModuleManager> {
  const started = await runLaunchSequence(prepare, projectFolder, env, options);
  try {
    await setupPostLaunchFeatures(started, projectFolder, env, options);
    return started.manager;
  } catch (error) {
    await started.shutdownManager.shutdown();
    throw error;
  }
}

let isRestarting = false;

async function restartProject(
  projectFolder: string,
  env: string,
  options: LaunchOptions,
): Promise<void> {
  if (isRestarting) return;
  isRestarting = true;

  try {
    const activeShutdownManager = activeShutdownManagers.at(-1);
    if (activeShutdownManager) {
      await activeShutdownManager.shutdown();
    }

    await startProject(prepareFromConfig, projectFolder, env, options);
  } finally {
    isRestarting = false;
  }
}

export async function launch(
  projectFolder: string = ".",
  env: string = DEFAULT_ENV,
  options: LaunchOptions = {},
): Promise<ModuleManager> {
  return startProject(prepareFromConfig, projectFolder, env, options);
}

export async function build(
  projectFolder: string = ".",
  env: string = DEFAULT_ENV,
  options: BuildOptions = {},
): Promise<void> {
  const runtimeConfig = await loadProjectRuntimeConfig(
    projectFolder,
    env,
    options,
  );
  const outdated = await checkOutdatedModules(
    runtimeConfig.normalizedConfig.modules,
  );
  warnOutdatedModules(outdated);

  await withRaisedMaxListeners(async () => {
    const manager = new ModuleManager();
    try {
      const entries = await loadModuleEntriesForManager(
        manager,
        runtimeConfig.normalizedConfig,
        false,
      );
      ensureGraphIsValid(manager);
      await writeProjectBuildArtifact(
        runtimeConfig.normalizedConfig,
        env,
        entries,
        runtimeConfig.fs,
      );
    } finally {
      await manager.destroyAll();
    }
  });
}

export async function launchFromBuild(
  projectFolder: string = ".",
  env: string = DEFAULT_ENV,
  options: LaunchOptions = {},
): Promise<ModuleManager> {
  return startProject(
    prepareFromArtifact,
    projectFolder,
    env || DEFAULT_ENV,
    options,
  );
}

export default launch;
