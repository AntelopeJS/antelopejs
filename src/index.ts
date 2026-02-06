import './interfaces/logging/beta';
import exitHook from 'async-exit-hook';
import EventEmitter from 'events';
import path from 'path';
import { Writable } from 'stream';
import { ModuleManager, ModuleConfig } from './core/module-manager';
import { ConfigLoader, LoadedConfig } from './core/config/config-loader';
import { ExpandedModuleConfig } from './core/config/config-parser';
import { NodeFileSystem } from './core/filesystem';
import { ModuleCache } from './core/module-cache';
import { DownloaderRegistry } from './core/downloaders/registry';
import { registerLocalDownloader } from './core/downloaders/local';
import { registerLocalFolderDownloader } from './core/downloaders/local-folder';
import { registerPackageDownloader } from './core/downloaders/package';
import { registerGitDownloader } from './core/downloaders/git';
import { Module } from './core/module';
import type { ModuleSource } from './types';
import { ModuleManifest } from './core/module-manifest';
import { LaunchOptions, ModuleSourceLocal } from './types';
import { setupAntelopeProjectLogging, addChannelFilter } from './logging';
import { Logging } from './interfaces/logging/beta';
import * as coreInterfaceBeta from './interfaces/core/beta';
import * as moduleInterfaceBeta from './interfaces/core/beta/modules';
import { terminalDisplay } from './core/cli/terminal-display';
import { FileWatcher } from './core/watch/file-watcher';
import { HotReload } from './core/watch/hot-reload';
import { ReplSession } from './core/repl/repl-session';
import { TestContext } from './core/test/test-context';
import { TestRunner } from './core/test/test-runner';

export { ModuleManager } from './core/module-manager';
export { Module } from './core/module';
export { ModuleManifest } from './core/module-manifest';
export { ConfigLoader } from './core/config/config-loader';
export { DownloaderRegistry } from './core/downloaders/registry';
export { ModuleCache } from './core/module-cache';
export { LaunchOptions } from './types';

const Logger = new Logging.Channel('loader');

const MAX_STREAM_LISTENERS = 20;
const EXIT_CODE_ERROR = 1;
const DEFAULT_MAX_EVENT_LISTENERS = 50;
const DEFAULT_ENV = 'default';
const DEFAULT_TEST_CACHE_FOLDER = '.cache';
const DEFAULT_TEST_FOLDER = 'test';
const TEST_FILE_PATTERN = /\.(test|spec)\.(js|ts)$/;
const INTERACTIVE_PROMPT = '> ';
const MODULE_STATUS_MAP: Record<string, moduleInterfaceBeta.ModuleInfo['status']> = {
  loaded: 'loaded',
  constructed: 'constructed',
  active: 'active',
};

Writable.prototype.setMaxListeners(MAX_STREAM_LISTENERS);

interface ModuleOverrideRef {
  module: string;
  id?: string;
}

type ModuleOverrideMap = Map<string, ModuleOverrideRef[]>;

interface ModuleManifestEntry {
  manifest: ModuleManifest;
  config: ModuleConfig;
}

interface NormalizedLoadedConfig extends LoadedConfig {
  cacheFolder: string;
  projectFolder: string;
  modules: Record<string, ExpandedModuleConfig>;
}

function setupProcessHandlers(): void {
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
      for (const err of reason.errors) {
        Logging.Error('  -', err);
      }
    }
    process.exit(EXIT_CODE_ERROR);
  });

  process.on('warning', (warning: Error) => {
    Logging.Warn('Warning:', warning.message);
  });
}

interface LoaderContext {
  fs: NodeFileSystem;
  cache: ModuleCache;
  registry: DownloaderRegistry;
  projectFolder: string;
}

async function createLoaderContext(config: { cacheFolder: string; projectFolder: string }): Promise<LoaderContext> {
  const fs = new NodeFileSystem();
  const cache = new ModuleCache(config.cacheFolder, fs);
  await cache.load();

  const registry = new DownloaderRegistry();
  registerLocalDownloader(registry, { fs });
  registerLocalFolderDownloader(registry, { fs });
  registerPackageDownloader(registry, { fs });
  registerGitDownloader(registry, { fs });

  return {
    fs,
    cache,
    registry,
    projectFolder: config.projectFolder,
  };
}

function mapImportOverrides(overrides?: Record<string, string[]>): ModuleOverrideMap {
  const mapped: ModuleOverrideMap = new Map();
  if (!overrides) {
    return mapped;
  }
  for (const [iface, modules] of Object.entries(overrides)) {
    mapped.set(
      iface,
      modules.map((module) => ({ module })),
    );
  }
  return mapped;
}

function exportImportOverrides(
  overrides?: ModuleOverrideMap,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!overrides) {
    return result;
  }
  for (const [iface, modules] of overrides.entries()) {
    result[iface] = modules.map((entry) => entry.module);
  }
  return result;
}

function getModuleStatus(module: { state: string }): moduleInterfaceBeta.ModuleInfo['status'] {
  return MODULE_STATUS_MAP[module.state] ?? 'unknown';
}

function toModuleSource(source: moduleInterfaceBeta.ModuleDefinition['source']): ModuleSource {
  const type = source?.type;
  if (type !== 'local' && type !== 'git' && type !== 'package' && type !== 'local-folder') {
    throw new Error(`Unsupported module source type: ${String(type)}`);
  }
  return source as ModuleSource;
}

function registerCoreModuleInterface(manager: ModuleManager, loaderContext: LoaderContext): void {
  coreInterfaceBeta.ImplementInterface(moduleInterfaceBeta, {
    ListModules: async () => manager.listModules(),
    GetModuleInfo: async (moduleId: string) => {
      const entry = manager.getModuleEntry(moduleId);
      if (!entry) {
        throw new Error(`Module not found: ${moduleId}`);
      }
      return {
        source: entry.module.manifest.source,
        config: entry.config.config,
        disabledExports: [...(entry.config.disabledExports ?? new Set())],
        importOverrides: exportImportOverrides(entry.config.importOverrides),
        localPath: entry.module.manifest.folder,
        status: getModuleStatus(entry.module),
      };
    },
    LoadModule: async (moduleId: string, declaration: moduleInterfaceBeta.ModuleDefinition, autostart = false) => {
      const source = toModuleSource(declaration.source);
      const manifests = await loaderContext.registry.load(loaderContext.projectFolder, loaderContext.cache, {
        ...source,
        id: moduleId,
      });

      await Promise.all(manifests.map((manifest) => manifest.loadExports()));

      const moduleConfig: ModuleConfig = {
        config: declaration.config,
        disabledExports: new Set(declaration.disabledExports ?? []),
        importOverrides: mapImportOverrides(declaration.importOverrides),
      };

      const created = manager.addModules(manifests.map((manifest) => ({ manifest, config: moduleConfig })));
      await manager.constructModules(created);
      if (autostart) {
        manager.startModules(created);
      }
      return created.map(({ module }) => module.id);
    },
    StartModule: async (moduleId: string) => {
      manager.getModule(moduleId)?.start();
    },
    StopModule: async (moduleId: string) => {
      manager.getModule(moduleId)?.stop();
    },
    DestroyModule: async (moduleId: string) => {
      await manager.getModule(moduleId)?.destroy();
    },
    ReloadModule: async (moduleId: string) => {
      const entry = manager.getLoadedModuleEntry(moduleId);
      if (!entry) {
        return;
      }

      await entry.module.destroy();

      const manifests = await loaderContext.registry.load(
        loaderContext.projectFolder,
        loaderContext.cache,
        { ...entry.module.manifest.source, id: moduleId },
      );
      const [manifest] = manifests;
      if (!manifest) {
        throw new Error(`Failed to reload module ${moduleId}: no manifest returned`);
      }
      await manifest.loadExports();

      const replacement = new Module(manifest);
      if (replacement.id !== moduleId) {
        throw new Error(`Reloaded module id mismatch: expected ${moduleId}, got ${replacement.id}`);
      }
      manager.replaceLoadedModule(moduleId, replacement);
      manager.refreshAssociations();

      await replacement.construct(entry.config.config);
      replacement.start();
    },
  });
}

async function registerCoreInterfaces(manager: ModuleManager): Promise<ModuleManifest> {
  const coreFolder = path.resolve(path.join(__dirname, '..'));
  const coreSource: ModuleSourceLocal = { type: 'local', path: coreFolder };
  const coreManifest = await ModuleManifest.create(coreFolder, coreSource, 'antelopejs');
  manager.addStaticModule({ manifest: coreManifest });
  return coreManifest;
}

interface ModuleBuildContext {
  fs: NodeFileSystem;
  cache: ModuleCache;
  registry: DownloaderRegistry;
  projectFolder: string;
}

function buildModuleOverrides(importOverrides?: ExpandedModuleConfig['importOverrides']): ModuleOverrideMap {
  const overrides: ModuleOverrideMap = new Map();
  if (!importOverrides) {
    return overrides;
  }
  for (const override of importOverrides) {
    const list = overrides.get(override.interface) ?? [];
    list.push({ module: override.source, id: override.id });
    overrides.set(override.interface, list);
  }
  return overrides;
}

function buildManifestEntries(manifests: ModuleManifest[], moduleConfig: ExpandedModuleConfig): ModuleManifestEntry[] {
  const overrides = buildModuleOverrides(moduleConfig.importOverrides);
  const disabledExports = new Set<string>(Array.isArray(moduleConfig.disabledExports) ? moduleConfig.disabledExports : []);
  return manifests.map((manifest) => ({
    manifest,
    config: {
      config: moduleConfig.config,
      disabledExports,
      importOverrides: overrides,
    },
  }));
}

async function createModuleBuildContext(
  config: NormalizedLoadedConfig,
  loaderContext?: LoaderContext,
): Promise<ModuleBuildContext> {
  const fs = loaderContext?.fs ?? new NodeFileSystem();
  const cache = loaderContext?.cache ?? new ModuleCache(config.cacheFolder, fs);
  if (!loaderContext?.cache) {
    await cache.load();
  }
  const registry = loaderContext?.registry ?? new DownloaderRegistry();
  if (!loaderContext?.registry) {
    registerLocalDownloader(registry, { fs });
    registerLocalFolderDownloader(registry, { fs });
    registerPackageDownloader(registry, { fs });
    registerGitDownloader(registry, { fs });
  }
  return {
    fs,
    cache,
    registry,
    projectFolder: loaderContext?.projectFolder ?? config.projectFolder,
  };
}

async function loadModuleEntries(
  modules: Record<string, ExpandedModuleConfig>,
  context: ModuleBuildContext,
): Promise<ModuleManifestEntry[]> {
  const modulePromises = Object.entries(modules).map(async ([id, moduleConfig]) => {
    const source = { ...moduleConfig.source, id };
    Logger.Debug(`Loading module ${id}`);
    try {
      Logger.Trace(`Starting LoadModule for ${id}`);
      const manifests = await context.registry.load(context.projectFolder, context.cache, source);
      Logger.Trace(`Module manifest loaded for ${id}`);
      const entries = buildManifestEntries(manifests, moduleConfig);
      Logger.Trace(`Modules created for ${id}`);
      return entries;
    } catch (err) {
      await terminalDisplay.failSpinner(`Failed to load module ${id}`);
      await terminalDisplay.cleanSpinner();
      Logger.Error(`Unexpected error while loading module ${id}:`);
      Logger.Error(err);
      throw err;
    }
  });
  return (await Promise.all(modulePromises)).flat();
}

async function loadEntryExports(extraManifests: ModuleManifest[], entries: ModuleManifestEntry[]): Promise<void> {
  await terminalDisplay.startSpinner(`Loading exports`);
  Logger.Trace(`Loading exports`);
  const exportTargets = [...extraManifests, ...entries.map((module) => module.manifest)];
  await Promise.all(exportTargets.map((manifest) => manifest.loadExports()));
  await terminalDisplay.stopSpinner(`Exports loaded`);
}

function validateModuleNameCollisions(entries: ModuleManifestEntry[]): void {
  const seen = new Set<string>();
  for (const module of entries) {
    if (seen.has(module.manifest.name)) {
      Logger.Error(`Detected module id collision (name in package.json): ${module.manifest.name}`);
    } else {
      seen.add(module.manifest.name);
    }
  }
}

async function buildModuleConfigs(
  config: NormalizedLoadedConfig,
  extraManifests: ModuleManifest[] = [],
  loaderContext?: LoaderContext,
): Promise<ModuleManifestEntry[]> {
  const context = await createModuleBuildContext(config, loaderContext);
  await terminalDisplay.startSpinner(`Loading modules`);
  const modules = await loadModuleEntries(config.modules ?? {}, context);
  await terminalDisplay.stopSpinner(`Modules loaded`);
  await loadEntryExports(extraManifests, modules);
  validateModuleNameCollisions(modules);
  return modules;
}

function normalizeLoadedConfig(loadedConfig: LoadedConfig, projectFolder: string): NormalizedLoadedConfig {
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

function getWatchDirs(source: ModuleSource): string[] {
  if (source.type !== 'local') {
    return [''];
  }
  const localSource = source as ModuleSourceLocal;
  if (Array.isArray(localSource.watchDir)) {
    return localSource.watchDir;
  }
  if (localSource.watchDir) {
    return [localSource.watchDir];
  }
  return [''];
}

async function reloadWatchedModule(manager: ModuleManager, moduleId: string): Promise<void> {
  const entry = manager.getModuleEntry(moduleId);
  if (!entry) {
    return;
  }
  manager.unrequireModuleFiles(moduleId);
  await entry.module.reload();
  await entry.module.construct(entry.config.config);
  entry.module.start();
}

async function loadAndStartModules(manager: ModuleManager, config: NormalizedLoadedConfig): Promise<void> {
  const loaderContext = await createLoaderContext(config);
  registerCoreModuleInterface(manager, loaderContext);
  const coreManifest = await registerCoreInterfaces(manager);
  const modules = await buildModuleConfigs(config, [coreManifest], loaderContext);
  manager.addModules(modules);
  await terminalDisplay.startSpinner(`Constructing modules`);
  Logger.Trace(`Constructing modules`);
  try {
    await manager.constructAll();
  } catch (err) {
    await terminalDisplay.failSpinner(`Failed to construct modules`);
    throw err;
  }
  await terminalDisplay.stopSpinner(`Done loading`);
  manager.startAll();
}

async function setupPostLaunchFeatures(
  manager: ModuleManager,
  fs: NodeFileSystem,
  options: LaunchOptions,
): Promise<void> {
  exitHook(async (callback) => {
    try {
      await manager.destroyAll();
    } catch (err) {
      Logger.Error('Error during shutdown:', err);
    } finally {
      callback();
    }
  });

  if (options.watch) {
    const watcher = new FileWatcher(fs);
    const hotReload = new HotReload(async (moduleId) => reloadWatchedModule(manager, moduleId));
    for (const { module } of manager.getLoadedModules()) {
      if (module.manifest?.source?.type === 'local') {
        await watcher.scanModule(module.id, module.manifest.folder, getWatchDirs(module.manifest.source));
      }
    }
    watcher.onModuleChanged((id) => hotReload.queue(id));
    watcher.startWatching();
  }

  if (options.interactive) {
    const repl = new ReplSession({ moduleManager: manager });
    repl.start(INTERACTIVE_PROMPT);
  }
}

async function initializeCore(projectFolder: string, env: string, options: LaunchOptions): Promise<{
  manager: ModuleManager;
  fs: NodeFileSystem;
}> {
  setupProcessHandlers();
  const fs = new NodeFileSystem();
  const loader = new ConfigLoader(fs);
  const loadedConfig = await loader.load(projectFolder, env);
  const normalizedConfig = normalizeLoadedConfig(loadedConfig, projectFolder);
  setupAntelopeProjectLogging(loadedConfig.logging);
  if (options.verbose) {
    options.verbose.forEach((channel) => addChannelFilter(channel, 0));
  }
  const originalMaxListeners = EventEmitter.defaultMaxListeners;
  EventEmitter.defaultMaxListeners = Math.max(originalMaxListeners, DEFAULT_MAX_EVENT_LISTENERS);
  const manager = new ModuleManager();
  try {
    await loadAndStartModules(manager, normalizedConfig);
  } finally {
    EventEmitter.defaultMaxListeners = originalMaxListeners;
  }
  return { manager, fs };
}

export async function launch(
  projectFolder: string = '.',
  env: string = DEFAULT_ENV,
  options: LaunchOptions = {},
): Promise<ModuleManager> {
  const initialized = await initializeCore(projectFolder, env, options);
  await setupPostLaunchFeatures(initialized.manager, initialized.fs, options);
  return initialized.manager;
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

interface TestModuleProjectConfig {
  project?: string;
  folder?: string;
}

interface LoadedTestConfig {
  testConfig: TestModuleProjectConfig;
  rawConfig: any;
  config: any;
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
  } catch (err) {
    console.error(`Failed to load test project config from ${testProjectPath}:`, err);
    return undefined;
  }

  const rawConfig = rawModule?.default ?? rawModule;
  const config = rawConfig && typeof rawConfig.setup === 'function' ? await rawConfig.setup() : rawConfig;
  return { testConfig, rawConfig, config };
}

async function setupTestEnvironment(moduleRoot: string, config: any): Promise<ModuleManager> {
  setupAntelopeProjectLogging(config?.logging);
  const cacheFolder = config?.cacheFolder ?? DEFAULT_TEST_CACHE_FOLDER;
  const absoluteCache = path.isAbsolute(cacheFolder) ? cacheFolder : path.join(moduleRoot, cacheFolder);
  const normalizedConfig: NormalizedLoadedConfig = {
    ...config,
    modules: config?.modules ?? {},
    cacheFolder: absoluteCache,
    projectFolder: moduleRoot,
    envOverrides: config?.envOverrides ?? {},
    name: config?.name ?? 'test',
  };
  const loaderContext = await createLoaderContext(normalizedConfig);
  const manager = new ModuleManager();
  registerCoreModuleInterface(manager, loaderContext);
  const coreManifest = await registerCoreInterfaces(manager);
  const modules = await buildModuleConfigs(normalizedConfig, [coreManifest], loaderContext);
  manager.addModules(modules);
  await terminalDisplay.startSpinner(`Constructing modules`);
  Logger.Trace(`Constructing modules`);
  try {
    await manager.constructAll();
  } catch (err) {
    await terminalDisplay.failSpinner(`Failed to construct modules`);
    throw err;
  }
  await terminalDisplay.stopSpinner(`Done loading`);
  manager.startAll();
  return manager;
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
