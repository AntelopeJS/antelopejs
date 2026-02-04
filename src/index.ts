// Preload logging interfaces to avoid CJS circular dependency issues.
import './interfaces/logging/beta';
import path from 'path';
import { ModuleManager, ModuleConfig } from './core/module-manager';
import { ConfigLoader } from './core/config/config-loader';
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

function mapImportOverrides(overrides?: Record<string, string[]>): Map<string, Array<{ module: string }>> {
  const mapped = new Map<string, Array<{ module: string }>>();
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
  overrides?: Map<string, Array<{ module: string; id?: string }>>,
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
  switch (module.state) {
    case 'loaded':
    case 'constructed':
    case 'active':
      return module.state;
    default:
      return 'unknown';
  }
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

async function buildModuleConfigs(
  config: Record<string, any>,
  extraManifests: ModuleManifest[] = [],
  loaderContext?: LoaderContext,
): Promise<Array<{ manifest: ModuleManifest; config: ModuleConfig }>> {
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
  const projectFolder = loaderContext?.projectFolder ?? config.projectFolder;

  await terminalDisplay.startSpinner(`Loading modules`);

  const modulePromises = Object.entries(config.modules ?? {}).map(async ([id, moduleConfig]) => {
    const entry = moduleConfig as any;
    const source = { ...entry.source, id };

    Logger.Debug(`Loading module ${id}`);

    try {
      Logger.Trace(`Starting LoadModule for ${id}`);
      const manifests = await registry.load(projectFolder, cache, source);
      Logger.Trace(`Module manifest loaded for ${id}`);

      const overrides = new Map<string, Array<{ module: string; id?: string }>>();
      if (entry.importOverrides) {
        for (const override of entry.importOverrides) {
          const list = overrides.get(override.interface) ?? [];
          list.push({ module: override.source, id: override.id });
          overrides.set(override.interface, list);
        }
      }

      const disabledExports = new Set<string>(Array.isArray(entry.disabledExports) ? entry.disabledExports : []);
      const created = manifests.map((manifest) => ({
        manifest,
        config: {
          config: entry.config,
          disabledExports,
          importOverrides: overrides,
        },
      }));

      Logger.Trace(`Modules created for ${id}`);
      return created;
    } catch (err) {
      await terminalDisplay.failSpinner(`Failed to load module ${id}`);
      await terminalDisplay.cleanSpinner();
      Logger.Error(`Unexpected error while loading module ${id}:`);
      Logger.Error(err);
      throw err;
    }
  });

  const moduleResults = await Promise.all(modulePromises);
  const modules = moduleResults.flat();
  await terminalDisplay.stopSpinner(`Modules loaded`);

  await terminalDisplay.startSpinner(`Loading exports`);
  Logger.Trace(`Loading exports`);
  const exportTargets = [...extraManifests, ...modules.map((module) => module.manifest)];
  await Promise.all(exportTargets.map((manifest) => manifest.loadExports()));
  await terminalDisplay.stopSpinner(`Exports loaded`);

  const seen = new Set<string>();
  for (const module of modules) {
    if (seen.has(module.manifest.name)) {
      Logger.Error(`Detected module id collision (name in package.json): ${module.manifest.name}`);
    } else {
      seen.add(module.manifest.name);
    }
  }

  return modules;
}

export async function launch(
  projectFolder: string = '.',
  env: string = 'default',
  options: LaunchOptions = {},
): Promise<ModuleManager> {
  const fs = new NodeFileSystem();
  const loader = new ConfigLoader(fs);
  const loadedConfig = await loader.load(projectFolder, env);

  const absoluteCache = path.isAbsolute(loadedConfig.cacheFolder)
    ? loadedConfig.cacheFolder
    : path.join(projectFolder, loadedConfig.cacheFolder);

  const normalizedConfig = {
    ...loadedConfig,
    cacheFolder: absoluteCache,
    projectFolder: path.resolve(projectFolder),
  } as any;

  setupAntelopeProjectLogging(loadedConfig.logging);

  if (options.verbose) {
    options.verbose.forEach((channel) => addChannelFilter(channel, 0));
  }

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

  if (options.watch) {
    const watcher = new FileWatcher(fs);
    const hotReload = new HotReload(async (moduleId) => {
      const mod = manager.getModule(moduleId);
      if (!mod) return;
      await mod.reload();
      await mod.construct((manager as any).config?.config);
      mod.start();
    });

    for (const { module } of (manager as any).loaded?.values?.() ?? []) {
      if (module.manifest?.source?.type === 'local') {
        const watchDirs = Array.isArray(module.manifest.source.watchDir)
          ? module.manifest.source.watchDir
          : module.manifest.source.watchDir
            ? [module.manifest.source.watchDir]
            : [''];
        await watcher.scanModule(module.id, module.manifest.folder, watchDirs);
      }
    }

    watcher.onModuleChanged((id) => hotReload.queue(id));
  }

  if (options.interactive) {
    const repl = new ReplSession({ moduleManager: manager });
    repl.start('> ');
  }

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
    // Folder doesn't exist or is not accessible.
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

  const packPath = path.join(moduleRoot, 'package.json');
  let pack: any;
  try {
    const packContent = await fs.readFileString(packPath, 'utf-8');
    pack = JSON.parse(packContent);
  } catch {
    console.error('Missing or invalid package.json');
    return 1;
  }

  const testConfig = pack.antelopeJs?.test;
  if (!testConfig) {
    console.error('Missing antelopeJs.test config in package.json');
    return 1;
  }

  if (!testConfig.project) {
    console.error('Missing antelopeJs.test.project in package.json');
    return 1;
  }

  const testProjectPath = path.isAbsolute(testConfig.project)
    ? testConfig.project
    : path.join(moduleRoot, testConfig.project);

  let rawModule: any;
  try {
    rawModule = await import(testProjectPath);
  } catch (err) {
    console.error(`Failed to load test project config from ${testProjectPath}:`, err);
    return 1;
  }

  const rawConfig = rawModule?.default ?? rawModule;
  const config = rawConfig && typeof rawConfig.setup === 'function' ? await rawConfig.setup() : rawConfig;

  let manager: ModuleManager | null = null;
  let managerActive = false;

  try {
    setupAntelopeProjectLogging(config?.logging);

    const cacheFolder = config?.cacheFolder ?? '.cache';
    const absoluteCache = path.isAbsolute(cacheFolder) ? cacheFolder : path.join(moduleRoot, cacheFolder);

    const normalizedConfig = {
      ...config,
      cacheFolder: absoluteCache,
      projectFolder: moduleRoot,
    };

    const loaderContext = await createLoaderContext(normalizedConfig);
    manager = new ModuleManager();
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
    managerActive = true;

    const testFolder = path.join(moduleRoot, testConfig.folder ?? 'test');
    const testFiles = await collectTestFiles(testFolder, /\.(test|spec)\.(js|ts)$/, fs);

    if (testFiles.length === 0) {
      console.error('No test files found');
      await manager.destroyAll();
      managerActive = false;
      return 1;
    }

    const Mocha = (await import('mocha')).default;
    const mocha = new Mocha();
    testFiles.forEach((file) => mocha.addFile(file));

    const failures = await new Promise<number>((resolve) => {
      mocha.run((count) => resolve(count));
    });

    await manager.destroyAll();
    managerActive = false;

    return failures;
  } finally {
    if (manager && managerActive) {
      await manager.destroyAll();
    }
    if (rawConfig && typeof rawConfig.cleanup === 'function') {
      await rawConfig.cleanup();
    }
  }
}

export default launch;
