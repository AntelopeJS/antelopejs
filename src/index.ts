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

async function buildModuleConfigs(config: Record<string, any>): Promise<Array<{ manifest: ModuleManifest; config: ModuleConfig }>> {
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
    const source = { ...entry.source, id } as any;
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
  options: LaunchOptions = {}
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
      if ((module.manifest as any).source?.type === 'local') {
        const watchDirs = Array.isArray((module.manifest as any).source.watchDir)
          ? (module.manifest as any).source.watchDir
          : (module.manifest as any).source.watchDir
            ? [(module.manifest as any).source.watchDir]
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

export async function TestModule(moduleFolder: string = '.', files: string[] = []): Promise<number> {
  const context = new TestContext({});
  const runner = new TestRunner(context);
  return runner.run(files);
}

export default launch;
