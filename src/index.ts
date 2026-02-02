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
import { ModuleManifest } from './core/module-manifest';
import { LaunchOptions } from './types';
import { setupAntelopeProjectLogging, addChannelFilter } from './logging';
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

async function buildModuleConfigs(
  config: Record<string, any>,
): Promise<Array<{ manifest: ModuleManifest; config: ModuleConfig }>> {
  const fs = new NodeFileSystem();
  const cache = new ModuleCache(config.cacheFolder, fs);
  await cache.load();

  const registry = new DownloaderRegistry();
  registerLocalDownloader(registry, { fs });
  registerLocalFolderDownloader(registry, { fs });
  registerPackageDownloader(registry, { fs });
  registerGitDownloader(registry, { fs });

  const modules: Array<{ manifest: ModuleManifest; config: ModuleConfig }> = [];

  for (const [id, moduleConfig] of Object.entries(config.modules ?? {})) {
    const entry = moduleConfig as any;
    const source = { ...entry.source, id };
    const manifests = await registry.load(config.projectFolder, cache, source);

    const overrides = new Map<string, Array<{ module: string; id?: string }>>();
    if (entry.importOverrides) {
      for (const override of entry.importOverrides) {
        const list = overrides.get(override.interface) ?? [];
        list.push({ module: override.source, id: override.id });
        overrides.set(override.interface, list);
      }
    }

    for (const manifest of manifests) {
      modules.push({
        manifest,
        config: {
          config: entry.config,
          disabledExports: new Set(entry.disabledExports ?? []),
          importOverrides: overrides,
        },
      });
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

  if (loadedConfig.logging) {
    setupAntelopeProjectLogging(loadedConfig.logging);
  }

  if (options.verbose) {
    options.verbose.forEach((channel) => addChannelFilter(channel, 0));
  }

  const manager = new ModuleManager();
  const modules = await buildModuleConfigs(normalizedConfig);
  manager.addModules(modules);
  await manager.constructAll();
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
    if (config?.logging) {
      setupAntelopeProjectLogging(config.logging);
    }

    const cacheFolder = config?.cacheFolder ?? '.cache';
    const absoluteCache = path.isAbsolute(cacheFolder) ? cacheFolder : path.join(moduleRoot, cacheFolder);

    const normalizedConfig = {
      ...config,
      cacheFolder: absoluteCache,
      projectFolder: moduleRoot,
    };

    manager = new ModuleManager();
    const modules = await buildModuleConfigs(normalizedConfig);
    manager.addModules(modules);

    await manager.constructAll();
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
