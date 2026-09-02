import { Writable } from "node:stream";
import { Logging } from "@antelopejs/interface-core/logging";
import type { LaunchOptions } from "../../types";
import { DEFAULT_ENV, tryFindConfigPath } from "../config/config-paths";
import type { NodeFileSystem } from "../filesystem";
import type { ModuleManager } from "../module-manager";
import type { ShutdownManager } from "../shutdown";
import {
  prepareFromArtifact,
  prepareFromConfig,
  runLaunchSequence,
} from "./launch-sequence";
import { releaseProcessShutdownManager } from "./runtime-bootstrap";
import { DEFAULT_RUNTIME_POLICY, type RuntimePolicy } from "./runtime-policy";
import type {
  LoaderContext,
  ProjectPreparer,
  StartedProject,
} from "./runtime-types";

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
  shutdownManager.register(
    () => shutdownModules(manager),
    SHUTDOWN_PRIORITY_MODULES,
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
  const [{ FileWatcher }, { HotReload }, moduleLoading] = await Promise.all([
    import("../watch/file-watcher"),
    import("../watch/hot-reload"),
    import("./module-loading"),
  ]);
  const watcher = new FileWatcher(fs);
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
    const { ReplSession } = await import("../repl/repl-session");
    const repl = new ReplSession({ moduleManager: manager });
    shutdownManager.register(async () => {
      repl.close();
    }, SHUTDOWN_PRIORITY_RESOURCES);
    repl.start(INTERACTIVE_PROMPT);
  }

  if (started.policy.signals) {
    setActiveShutdownManager(shutdownManager);
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
    const activeShutdownManager = activeShutdownManagers.at(-1);
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
  options: LaunchOptions = {},
): Promise<ModuleManager> {
  const started = await startProject(
    prepareFromArtifact,
    projectFolder,
    env || DEFAULT_ENV,
    options,
  );
  return started.manager;
}
