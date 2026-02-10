import { Logging } from './interfaces/logging/beta';
import path from 'path';
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
import { TestContext } from './core/test/test-context';
import { TestRunner } from './core/test/test-runner';
import {
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
import { BuildOptions, NormalizedLoadedConfig } from './core/runtime/runtime-types';

export { ModuleManager } from './core/module-manager';
export { Module } from './core/module';
export { ModuleManifest } from './core/module-manifest';
export { ConfigLoader } from './core/config/config-loader';
export { DEFAULT_ENV } from './core/config/config-paths';
export { DownloaderRegistry } from './core/downloaders/registry';
export { ModuleCache } from './core/module-cache';
export { LaunchOptions } from './types';
export type { BuildOptions } from './core/runtime/runtime-types';

const Logger = new Logging.Channel('loader');

const MAX_STREAM_LISTENERS = 20;
const EXIT_CODE_ERROR = 1;
const DEFAULT_TEST_CACHE_FOLDER = '.cache';
const DEFAULT_TEST_FOLDER = 'test';
const TEST_FILE_PATTERN = /\.(test|spec)\.(js|ts)$/;
const INTERACTIVE_PROMPT = '> ';
const SHUTDOWN_PRIORITY_MODULES = 30;
const SHUTDOWN_PRIORITY_RESOURCES = 20;
const SHUTDOWN_PRIORITY_CLEANUP = 10;

Writable.prototype.setMaxListeners(MAX_STREAM_LISTENERS);

interface CoreInitialization {
  manager: ModuleManager;
  fs: NodeFileSystem;
  shutdownManager: ShutdownManager;
}

interface TestModuleProjectConfig {
  project?: string;
  folder?: string;
}

interface LoadedTestConfig {
  testConfig: TestModuleProjectConfig;
  rawConfig: any;
  config: any;
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
): Promise<void> {
  registerModuleShutdownHandler(shutdownManager, manager);
  registerShutdownCleanup(shutdownManager);

  if (options.watch) {
    const watcher = new FileWatcher(fs);
    const hotReload = new HotReload(async (moduleId) => reloadWatchedModule(manager, moduleId));

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

  const manager = await withRaisedMaxListeners(async () => {
    const moduleManager = new ModuleManager();
    await loadModuleEntriesForManager(moduleManager, runtimeConfig.normalizedConfig, true);
    await constructAndStartModules(moduleManager);
    return moduleManager;
  });

  return {
    manager,
    fs: runtimeConfig.fs,
    shutdownManager,
  };
}

export async function launch(
  projectFolder: string = '.',
  env: string = DEFAULT_ENV,
  options: LaunchOptions = {},
): Promise<ModuleManager> {
  const initialized = await initializeCore(projectFolder, env, options);
  await setupPostLaunchFeatures(initialized.manager, initialized.fs, options, initialized.shutdownManager);
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

async function collectTestFiles(folder: string, pattern: RegExp, fs: NodeFileSystem): Promise<string[]> {
  const files: string[] = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        await scanDir(fullPath);
      } else if (pattern.test(entry)) {
        files.push(fullPath);
      }
    }
  }

  try {
    await scanDir(folder);
  } catch {
    return files;
  }

  return files;
}

export async function TestModule(moduleFolder: string = '.', files: string[] = []): Promise<number> {
  if (files.length > 0) {
    const context = new TestContext({});
    const runner = new TestRunner(context);
    return runner.run(files);
  }

  const moduleRoot = path.resolve(moduleFolder);
  const fs = new NodeFileSystem();
  const loadedConfig = await loadTestConfig(moduleRoot, fs);
  if (!loadedConfig) {
    return EXIT_CODE_ERROR;
  }

  let manager: ModuleManager | null = null;
  let managerActive = false;

  try {
    manager = await setupTestEnvironment(moduleRoot, loadedConfig.config);
    managerActive = true;

    const failures = await executeTests(moduleRoot, loadedConfig.testConfig, fs);
    if (failures === EXIT_CODE_ERROR) {
      await manager.destroyAll();
      managerActive = false;
      return EXIT_CODE_ERROR;
    }

    await manager.destroyAll();
    managerActive = false;
    return failures;
  } finally {
    if (manager && managerActive) {
      await manager.destroyAll();
    }
    if (loadedConfig.rawConfig && typeof loadedConfig.rawConfig.cleanup === 'function') {
      await loadedConfig.rawConfig.cleanup();
    }
  }
}

async function loadTestConfig(moduleRoot: string, fs: NodeFileSystem): Promise<LoadedTestConfig | undefined> {
  const packPath = path.join(moduleRoot, 'package.json');

  let pack: any;
  try {
    const packContent = await fs.readFileString(packPath, 'utf-8');
    pack = JSON.parse(packContent);
  } catch {
    console.error('Missing or invalid package.json');
    return undefined;
  }

  const testConfig = pack.antelopeJs?.test;
  if (!testConfig) {
    console.error('Missing antelopeJs.test config in package.json');
    return undefined;
  }

  if (!testConfig.project) {
    console.error('Missing antelopeJs.test.project in package.json');
    return undefined;
  }

  const testProjectPath = path.isAbsolute(testConfig.project)
    ? testConfig.project
    : path.join(moduleRoot, testConfig.project);

  let rawModule: any;
  try {
    rawModule = await import(testProjectPath);
  } catch (error) {
    console.error(`Failed to load test project config from ${testProjectPath}:`, error);
    return undefined;
  }

  const rawConfig = rawModule?.default ?? rawModule;
  const config = rawConfig && typeof rawConfig.setup === 'function' ? await rawConfig.setup() : rawConfig;
  return { testConfig, rawConfig, config };
}

function createTestRuntimeConfig(moduleRoot: string, config: any): NormalizedLoadedConfig {
  const cacheFolder = config?.cacheFolder ?? DEFAULT_TEST_CACHE_FOLDER;
  const absoluteCache = path.isAbsolute(cacheFolder) ? cacheFolder : path.join(moduleRoot, cacheFolder);

  return {
    ...config,
    modules: config?.modules ?? {},
    cacheFolder: absoluteCache,
    projectFolder: moduleRoot,
    envOverrides: config?.envOverrides ?? {},
    name: config?.name ?? 'test',
  };
}

async function setupTestEnvironment(moduleRoot: string, config: any): Promise<ModuleManager> {
  setupAntelopeProjectLogging(config?.logging);
  const normalizedConfig = createTestRuntimeConfig(moduleRoot, config);

  return withRaisedMaxListeners(async () => {
    const manager = new ModuleManager();
    await loadModuleEntriesForManager(manager, normalizedConfig, true);
    await constructAndStartModules(manager);
    return manager;
  });
}

async function executeTests(
  moduleRoot: string,
  testConfig: TestModuleProjectConfig,
  fs: NodeFileSystem,
): Promise<number> {
  const testFolder = path.join(moduleRoot, testConfig.folder ?? DEFAULT_TEST_FOLDER);
  const testFiles = await collectTestFiles(testFolder, TEST_FILE_PATTERN, fs);
  if (testFiles.length === 0) {
    console.error('No test files found');
    return EXIT_CODE_ERROR;
  }

  const Mocha = (await import('mocha')).default;
  const mocha = new Mocha();
  testFiles.forEach((file) => mocha.addFile(file));

  return new Promise<number>((resolve) => {
    mocha.run((count) => resolve(count));
  });
}

export default launch;
