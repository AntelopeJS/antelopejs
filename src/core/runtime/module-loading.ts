import path from 'path';
import { Module } from '../module';
import { ModuleCache } from '../module-cache';
import { ModuleManager, ModuleConfig } from '../module-manager';
import { ModuleManifest } from '../module-manifest';
import { NodeFileSystem } from '../filesystem';
import { DownloaderRegistry } from '../downloaders/registry';
import { registerGitDownloader } from '../downloaders/git';
import { registerLocalDownloader } from '../downloaders/local';
import { registerLocalFolderDownloader } from '../downloaders/local-folder';
import { registerPackageDownloader } from '../downloaders/package';
import { terminalDisplay } from '../cli/terminal-display';
import * as coreInterfaceBeta from '../../interfaces/core/beta';
import * as moduleInterfaceBeta from '../../interfaces/core/beta/modules';
import { ModuleSource, ModuleSourceLocal } from '../../types';
import { Logging } from '../../interfaces/logging/beta';
import { ExpandedModuleConfig } from '../config/config-parser';
import {
  InterfaceGraphIssue,
  LoaderContext,
  ModuleBuildContext,
  ModuleManifestEntry,
  ModuleOverrideMap,
  ModuleOverrideRef,
  NormalizedLoadedConfig,
} from './runtime-types';

const Logger = new Logging.Channel('loader');

const MODULE_STATUS_MAP: Record<string, moduleInterfaceBeta.ModuleInfo['status']> = {
  loaded: 'loaded',
  constructed: 'constructed',
  active: 'active',
};

function mapImportOverrides(overrides?: Record<string, string[]>): ModuleOverrideMap {
  const mapped: ModuleOverrideMap = new Map();
  if (!overrides) {
    return mapped;
  }

  for (const [interfaceName, modules] of Object.entries(overrides)) {
    const overrideEntries = modules.map((module): ModuleOverrideRef => ({ module }));
    mapped.set(interfaceName, overrideEntries);
  }

  return mapped;
}

function exportImportOverrides(overrides?: ModuleOverrideMap): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!overrides) {
    return result;
  }

  for (const [interfaceName, modules] of overrides.entries()) {
    result[interfaceName] = modules.map((entry) => entry.module);
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

export async function createLoaderContext(config: {
  cacheFolder: string;
  projectFolder: string;
}): Promise<LoaderContext> {
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

export function registerCoreModuleInterface(manager: ModuleManager, loaderContext: LoaderContext): void {
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
      await manager.getModule(moduleId)?.stop();
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

      const manifests = await loaderContext.registry.load(loaderContext.projectFolder, loaderContext.cache, {
        ...entry.module.manifest.source,
        id: moduleId,
      });
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

export async function registerCoreInterfaces(manager: ModuleManager): Promise<ModuleManifest> {
  const coreFolder = path.resolve(path.join(__dirname, '..', '..', '..'));
  const coreSource: ModuleSourceLocal = { type: 'local', path: coreFolder };
  const coreManifest = await ModuleManifest.create(coreFolder, coreSource, 'antelopejs');
  manager.addStaticModule({ manifest: coreManifest });
  return coreManifest;
}

function buildModuleOverrides(importOverrides?: ExpandedModuleConfig['importOverrides']): ModuleOverrideMap {
  const overrides: ModuleOverrideMap = new Map();
  if (!importOverrides) {
    return overrides;
  }

  importOverrides.forEach((override) => {
    const existing = overrides.get(override.interface) ?? [];
    existing.push({ module: override.source, id: override.id });
    overrides.set(override.interface, existing);
  });

  return overrides;
}

function buildManifestEntries(manifests: ModuleManifest[], moduleConfig: ExpandedModuleConfig): ModuleManifestEntry[] {
  const overrides = buildModuleOverrides(moduleConfig.importOverrides);
  const disabledExports = new Set<string>(moduleConfig.disabledExports ?? []);

  return manifests.map((manifest) => ({
    manifest,
    config: {
      config: moduleConfig.config,
      disabledExports,
      importOverrides: overrides,
    },
  }));
}

function createRegistry(fs: NodeFileSystem): DownloaderRegistry {
  const registry = new DownloaderRegistry();
  registerLocalDownloader(registry, { fs });
  registerLocalFolderDownloader(registry, { fs });
  registerPackageDownloader(registry, { fs });
  registerGitDownloader(registry, { fs });
  return registry;
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

  const registry = loaderContext?.registry ?? createRegistry(fs);
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
      return buildManifestEntries(manifests, moduleConfig);
    } catch (error) {
      await terminalDisplay.failSpinner(`Failed to load module ${id}`);
      await terminalDisplay.cleanSpinner();
      Logger.Error(`Unexpected error while loading module ${id}:`);
      Logger.Error(error);
      throw error;
    }
  });

  return (await Promise.all(modulePromises)).flat();
}

async function loadEntryExports(extraManifests: ModuleManifest[], entries: ModuleManifestEntry[]): Promise<void> {
  await terminalDisplay.startSpinner(`Loading exports`);
  Logger.Trace(`Loading exports`);

  const exportTargets = [...extraManifests, ...entries.map((entry) => entry.manifest)];
  await Promise.all(exportTargets.map((manifest) => manifest.loadExports()));

  await terminalDisplay.stopSpinner(`Exports loaded`);
}

function validateModuleNameCollisions(entries: ModuleManifestEntry[]): void {
  const seenNames = new Set<string>();
  entries.forEach((entry) => {
    if (seenNames.has(entry.manifest.name)) {
      Logger.Error(`Detected module id collision (name in package.json): ${entry.manifest.name}`);
      return;
    }
    seenNames.add(entry.manifest.name);
  });
}

export async function buildModuleConfigs(
  config: NormalizedLoadedConfig,
  extraManifests: ModuleManifest[] = [],
  loaderContext?: LoaderContext,
): Promise<ModuleManifestEntry[]> {
  const context = await createModuleBuildContext(config, loaderContext);
  await terminalDisplay.startSpinner(`Loading modules`);
  const modules = await loadModuleEntries(config.modules, context);
  await terminalDisplay.stopSpinner(`Modules loaded`);
  await loadEntryExports(extraManifests, modules);
  validateModuleNameCollisions(modules);
  return modules;
}

export function getWatchDirs(source: ModuleSource): string[] {
  if (source.type !== 'local') {
    return [''];
  }

  const localSource = source as ModuleSourceLocal;
  if (Array.isArray(localSource.watchDir)) {
    return localSource.watchDir;
  }

  return localSource.watchDir ? [localSource.watchDir] : [''];
}

export async function reloadWatchedModule(manager: ModuleManager, moduleId: string): Promise<void> {
  const entry = manager.getModuleEntry(moduleId);
  if (!entry) {
    return;
  }

  manager.unrequireModuleFiles(moduleId);
  await entry.module.reload();
  await entry.module.construct(entry.config.config);
  entry.module.start();
}

export async function loadModuleEntriesForManager(
  manager: ModuleManager,
  config: NormalizedLoadedConfig,
  runtimeInterface: boolean,
): Promise<ModuleManifestEntry[]> {
  const loaderContext = await createLoaderContext(config);
  if (runtimeInterface) {
    registerCoreModuleInterface(manager, loaderContext);
  }

  const coreManifest = await registerCoreInterfaces(manager);
  const entries = await buildModuleConfigs(config, [coreManifest], loaderContext);
  manager.addModules(entries);
  return entries;
}

export async function constructAndStartModules(manager: ModuleManager): Promise<void> {
  await terminalDisplay.startSpinner(`Constructing modules`);
  Logger.Trace(`Constructing modules`);

  try {
    await manager.constructAll();
  } catch (error) {
    await terminalDisplay.failSpinner(`Failed to construct modules`);
    throw error;
  }

  await terminalDisplay.stopSpinner(`Done loading`);
  manager.startAll();
}

function collectGraphIssues(manager: ModuleManager): InterfaceGraphIssue[] {
  const issues: InterfaceGraphIssue[] = [];
  for (const { module } of manager.getLoadedModules()) {
    const associations = manager.resolver.moduleAssociations.get(module.id);
    module.manifest.imports.forEach((interfaceName) => {
      if (!associations?.has(interfaceName)) {
        issues.push({ moduleId: module.id, interfaceName });
      }
    });
  }

  return issues;
}

export function ensureGraphIsValid(manager: ModuleManager): void {
  const issues = collectGraphIssues(manager);
  if (issues.length === 0) {
    return;
  }

  const summary = issues.map((issue) => `  - ${issue.moduleId} -> ${issue.interfaceName}`).join('\n');
  throw new Error(`Failed to resolve module interface graph:\n${summary}`);
}
