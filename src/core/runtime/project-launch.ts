import path from "node:path";
import { Writable } from "node:stream";
import { Logging } from "@antelopejs/interface-core/logging";

import type { BuildLaunchOptions, LaunchOptions } from "../../types";
import type { NodeFileSystem } from "../filesystem";
import type { ModuleManager } from "../module-manager";
import { getActiveShutdownManager } from "./process-claim";
import { tolerateInvalidatedModuleWork } from "./runtime-bootstrap";
import {
  DEFAULT_ENV,
  PROJECT_STATE_DIR,
  tryFindConfigPath,
} from "../config/config-paths";
import type { ShutdownManager } from "../shutdown";
import type { FileWatcher } from "../watch/file-watcher";
import { DEFAULT_RUNTIME_POLICY, type RuntimePolicy } from "./runtime-policy";
import type {
  LoaderContext,
  ProjectPreparer,
  StartedProject,
} from "./runtime-types";
import {
  prepareFromArtifact,
  prepareFromConfig,
  prepareFromRefreshedArtifact,
  runLaunchSequence,
} from "./launch-sequence";

const Logger = new Logging.Channel("loader");

const MAX_STREAM_LISTENERS = 20;
const INTERACTIVE_PROMPT = "> ";
const SHUTDOWN_PRIORITY_RESOURCES = 20;
const SHUTDOWN_PRIORITY_CLEANUP = 10;
const UNSUPPORTED_ARTIFACT_OPTIONS_WARNING =
  "Watch and interactive modes are only available when launching from configuration; ignoring them for this build artifact launch.";

Writable.prototype.setMaxListeners(MAX_STREAM_LISTENERS);

/**
 * Lets a module fail to reload without taking the dev process down, until the
 * project shuts down: work its destroyed generations left pending may still
 * fail while the modules are torn down.
 */
function keepRunningThroughFailedReloads(
  shutdownManager: ShutdownManager,
): void {
  const withdraw = tolerateInvalidatedModuleWork();
  shutdownManager.register(async () => {
    withdraw();
  }, SHUTDOWN_PRIORITY_CLEANUP);
}

function excludeProjectState(
  watcher: FileWatcher,
  projectFolder: string,
  loaderContext: LoaderContext,
): void {
  watcher.excludePath(path.resolve(projectFolder, PROJECT_STATE_DIR));
  watcher.excludePath(path.resolve(projectFolder, loaderContext.cache.path));
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
  const [{ FileWatcher }, { HotReload }, moduleLoading] = await Promise.all([
    import("../watch/file-watcher"),
    import("../watch/hot-reload"),
    import("./module-loading"),
  ]);
  const watcher = new FileWatcher(fs);
  excludeProjectState(watcher, projectFolder, loaderContext);
  const loadedSignatures = new Map<string, string>();
  const hotReload = new HotReload(async (moduleId) => {
    const signature = watcher.getModuleSignature(moduleId);
    if (loadedSignatures.get(moduleId) === signature) {
      return;
    }
    await moduleLoading.reloadWatchedModule(manager, moduleId, loaderContext);
    loadedSignatures.set(moduleId, signature);
  });

  shutdownManager.register(async () => {
    hotReload.clear();
    watcher.stopWatching();
  }, SHUTDOWN_PRIORITY_RESOURCES);
  keepRunningThroughFailedReloads(shutdownManager);

  for (const { module } of manager.getLoadedModules()) {
    if (module.manifest?.source?.type === "local") {
      const watchDirs = moduleLoading.getWatchDirs(module.manifest.source);
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
    const { ReplSession } = await import("../repl/repl-session");
    const repl = new ReplSession({ moduleManager: manager });
    shutdownManager.register(async () => {
      repl.close();
    }, SHUTDOWN_PRIORITY_RESOURCES);
    repl.start(INTERACTIVE_PROMPT);
  }
}

export async function startProject(
  prepare: ProjectPreparer,
  projectFolder: string,
  env: string,
  options: LaunchOptions,
  policy: RuntimePolicy = DEFAULT_RUNTIME_POLICY,
): Promise<StartedProject> {
  const started = await runLaunchSequence(
    prepare,
    projectFolder,
    env,
    options,
    policy,
  );
  try {
    await setupPostLaunchFeatures(started, projectFolder, env, options);
    return started;
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
    const activeShutdownManager = getActiveShutdownManager();
    if (activeShutdownManager) {
      await activeShutdownManager.shutdown();
    }

    await startProject(prepareFromConfig, projectFolder, env, options);
  } finally {
    isRestarting = false;
  }
}

export async function launchFromBuild(
  projectFolder: string = ".",
  env: string = DEFAULT_ENV,
  options: BuildLaunchOptions = {},
): Promise<ModuleManager> {
  const started = await startProject(
    options.refreshConfig ? prepareFromRefreshedArtifact : prepareFromArtifact,
    projectFolder,
    env || DEFAULT_ENV,
    options,
  );
  return started.manager;
}
