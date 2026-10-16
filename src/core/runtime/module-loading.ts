import path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import * as coreInterfaceBeta from "@antelopejs/interface-core";
import * as moduleInterfaceBeta from "@antelopejs/interface-core/modules";
import type {
  ModuleSource,
  ModuleSourceLocal,
} from "@antelopejs/interface-core/config";

import { Module } from "../module";
import type { ModuleDeclarationChanges } from "../config/module-entry";
import {
  listModuleDeclarations,
  removeModuleDeclaration,
  saveModuleDeclaration,
} from "../config/module-declarations";
import { ModuleState } from "../../types";
import { ModuleCache } from "../module-cache";
import { NodeFileSystem } from "../filesystem";
import { ModuleManifest } from "../module-manifest";
import { pluralize } from "../cli/output/format";
import { CliError } from "../cli/output/errors";
import { describeFailure } from "../cli/output/failures";
import { getProcessTasks, runTask } from "../cli/output/tasks";
import type { ExpandedModuleConfig } from "../config/config-parser";
import {
  findUnresolvedInterfaces,
  type InterfaceConsumer,
  type InterfaceProvider,
  type InterfaceResolutionResult,
  type UnresolvedInterface,
} from "../resolution/interface-resolution";
import type {
  ManagedModule,
  ModuleConfig,
  ModuleManager,
} from "../module-manager";
import type {
  LoaderConfig,
  LoaderContext,
  LoaderContextProvider,
  ModuleManifestEntry,
  ModuleOverrideMap,
  ModuleOverrideRef,
  NormalizedLoadedConfig,
} from "./runtime-types";

const Logger = new Logging.Channel("loader");
const CORE_MODULE_ID = "antelopejs";

const MODULE_STATUS_MAP: Record<
  string,
  moduleInterfaceBeta.ModuleInfo["status"]
> = {
  loaded: "loaded",
  constructed: "constructed",
  active: "active",
};

function mapImportOverrides(
  overrides?: Record<string, string[]>,
): ModuleOverrideMap {
  const mapped: ModuleOverrideMap = new Map();
  if (!overrides) {
    return mapped;
  }

  for (const [interfaceName, modules] of Object.entries(overrides)) {
    const overrideEntries = modules.map((module): ModuleOverrideRef => ({
      module,
    }));
    mapped.set(interfaceName, overrideEntries);
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

  for (const [interfaceName, modules] of overrides.entries()) {
    result[interfaceName] = modules.flatMap((entry) =>
      entry.module === undefined ? [] : [entry.module],
    );
  }

  return result;
}

function getModuleStatus(module: {
  state: string;
}): moduleInterfaceBeta.ModuleInfo["status"] {
  return MODULE_STATUS_MAP[module.state] ?? "unknown";
}

function toModuleSource(
  source: moduleInterfaceBeta.ModuleDefinition["source"],
): ModuleSource {
  const type = source?.type;
  if (
    type !== "local" &&
    type !== "git" &&
    type !== "package" &&
    type !== "local-folder"
  ) {
    throw new Error(`Unsupported module source type: ${String(type)}`);
  }
  return source as ModuleSource;
}

export async function createLoaderContext(
  config: LoaderConfig,
  fs: NodeFileSystem = new NodeFileSystem(),
): Promise<LoaderContext> {
  const [{ DownloaderRegistry }, git, local, localFolder, packageDownloader] =
    await Promise.all([
      import("../downloaders/registry"),
      import("../downloaders/git"),
      import("../downloaders/local"),
      import("../downloaders/local-folder"),
      import("../downloaders/package"),
    ]);
  const cache = new ModuleCache(config.cacheFolder, fs);
  await cache.load();

  const registry = new DownloaderRegistry();
  local.registerLocalDownloader(registry, { fs });
  localFolder.registerLocalFolderDownloader(registry, { fs });
  packageDownloader.registerPackageDownloader(registry, { fs });
  git.registerGitDownloader(registry, { fs });

  return {
    fs,
    cache,
    registry,
    projectFolder: config.projectFolder,
  };
}

/**
 * Takes down the running generation of every module `manifests` replaces, so
 * `LoadModule` on an id that is already loaded behaves like a reload. Without
 * this the replacement is required from the files the previous generation
 * left in the require cache, whose interface calls are bound to its
 * now-invalidated context: its `construct` fails with
 * `ModuleContextInvalidatedError`.
 */
async function retireReplacedModules(
  manager: ModuleManager,
  manifests: ModuleManifest[],
): Promise<void> {
  for (const manifest of manifests) {
    const previous = manager.getLoadedModuleEntry(manifest.name);
    if (!previous) {
      continue;
    }
    await previous.module.stop();
    await previous.module.destroy();
    manager.unrequireModuleFiles(manifest.name);
  }
}

/**
 * Checks the interfaces of modules `LoadModule` just added, then constructs
 * and optionally starts them. When any of that fails, they are destroyed and
 * dropped again: a module left behind would still count as a consumer of its
 * interface packages, and every later load would fail its checks.
 */
export async function activateLoadedModules(
  manager: ModuleManager,
  created: ManagedModule[],
  autostart: boolean,
): Promise<void> {
  try {
    ensureInterfacesResolved(manager, created);
    await manager.constructModules(created);
    if (autostart) {
      await manager.startModules(created);
    }
  } catch (error) {
    await Promise.allSettled(created.map(({ module }) => module.destroy()));
    manager.discardModules(created.map(({ module }) => module.id));
    throw error;
  }
}

export function registerCoreModuleInterface(
  manager: ModuleManager,
  loadContext: LoaderContextProvider,
): void {
  moduleInterfaceBeta.RunWithModuleContext({ module: CORE_MODULE_ID }, () =>
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
      LoadModule: async (
        moduleId: string,
        declaration: moduleInterfaceBeta.ModuleDefinition,
        autostart = false,
      ) => {
        const source = toModuleSource(declaration.source);
        const loaderContext = await loadContext();
        const manifests = await loaderContext.registry.load(
          loaderContext.projectFolder,
          loaderContext.cache,
          {
            ...source,
            id: moduleId,
          },
        );

        await retireReplacedModules(manager, manifests);

        const moduleConfig: ModuleConfig = {
          config: declaration.config,
          disabledExports: new Set(declaration.disabledExports ?? []),
          importOverrides: mapImportOverrides(declaration.importOverrides),
        };

        const created = manager.addModules(
          manifests.map((manifest) => ({ manifest, config: moduleConfig })),
        );
        await activateLoadedModules(manager, created, autostart);
        return created.map(({ module }) => module.id);
      },
      StartModule: async (moduleId: string) => {
        await manager.getModule(moduleId)?.start();
      },
      StopModule: async (moduleId: string) => {
        await manager.getModule(moduleId)?.stop();
      },
      DestroyModule: async (moduleId: string) => {
        await manager.getModule(moduleId)?.destroy();
      },
      ListModuleDeclarations: async () =>
        listModuleDeclarations((await loadContext()).projectFolder),
      SaveModuleDeclaration: async (
        moduleId: string,
        changes: ModuleDeclarationChanges,
      ) =>
        saveModuleDeclaration(
          (await loadContext()).projectFolder,
          moduleId,
          changes,
        ),
      RemoveModuleDeclaration: async (moduleId: string) =>
        removeModuleDeclaration((await loadContext()).projectFolder, moduleId),
      ReloadModule: async (moduleId: string) => {
        await reloadLoadedModuleFromSource(
          manager,
          await loadContext(),
          moduleId,
        );
      },
    }),
  );
}

export async function registerCoreInterfaces(
  manager: ModuleManager,
): Promise<ModuleManifest> {
  const coreFolder = path.resolve(path.join(__dirname, "..", "..", ".."));
  const coreSource: ModuleSourceLocal = { type: "local", path: coreFolder };
  const coreManifest = await ModuleManifest.create(
    coreFolder,
    coreSource,
    "antelopejs",
  );
  manager.addStaticModule({ manifest: coreManifest });
  return coreManifest;
}

export function buildModuleOverrides(
  importOverrides?: ExpandedModuleConfig["importOverrides"],
): ModuleOverrideMap {
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

export function toModuleConfig(
  moduleConfig: ExpandedModuleConfig,
): ModuleConfig {
  return {
    config: moduleConfig.config,
    disabledExports: new Set<string>(moduleConfig.disabledExports ?? []),
    importOverrides: buildModuleOverrides(moduleConfig.importOverrides),
    exportPriority: new Map(Object.entries(moduleConfig.exportPriority ?? {})),
    optional: moduleConfig.optional,
  };
}

function buildManifestEntries(
  manifests: ModuleManifest[],
  moduleConfig: ExpandedModuleConfig,
): ModuleManifestEntry[] {
  const config = toModuleConfig(moduleConfig);

  return manifests.map((manifest) => ({ manifest, config: { ...config } }));
}

async function loadModuleEntry(
  id: string,
  moduleConfig: ExpandedModuleConfig,
  context: LoaderContext,
): Promise<ModuleManifestEntry[]> {
  const source = { ...moduleConfig.source, id };
  Logger.Debug(`Loading module ${id}`);
  Logger.Trace(`Starting LoadModule for ${id}`);
  const manifests = await context.registry.load(
    context.projectFolder,
    context.cache,
    source,
  );
  Logger.Trace(`Module manifest loaded for ${id}`);
  return buildManifestEntries(manifests, moduleConfig);
}

function uniqueFixes(failures: unknown[]): string[] {
  const fixes = failures.flatMap(
    (failure) => describeFailure(failure, false).fixes ?? [],
  );
  return [...new Set(fixes)];
}

/**
 * One error for every module that failed to load. A single failure is
 * thrown as is; several are each listed once, by title and reason, and
 * summed up by one error carrying their fixes and the first one as cause.
 */
function moduleLoadFailure(failures: unknown[], total: number): unknown {
  if (failures.length === 1) {
    return failures[0];
  }
  const tasks = getProcessTasks();
  failures.forEach((failure) => {
    const problem = describeFailure(failure, false);
    tasks.message("error", problem.title, { detail: problem.reason });
  });
  return new CliError(
    {
      title: `Could not load ${failures.length} of ${pluralize(total, "module")}`,
      fixes: uniqueFixes(failures),
    },
    { cause: failures[0] },
  );
}

/**
 * Logs that optional module `id` could not be downloaded: the project starts
 * without it.
 */
function skipOptionalModule(id: string, reason: unknown): void {
  Logger.Error(
    `Optional module ${id} could not be loaded; starting without it`,
    reason,
  );
}

async function loadModuleEntries(
  modules: Record<string, ExpandedModuleConfig>,
  context: LoaderContext,
): Promise<ModuleManifestEntry[]> {
  const declared = Object.entries(modules);
  const results = await Promise.allSettled(
    declared.map(([id, moduleConfig]) =>
      loadModuleEntry(id, moduleConfig, context),
    ),
  );
  const failures: unknown[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    const [id, moduleConfig] = declared[index];
    if (moduleConfig.optional) {
      skipOptionalModule(id, result.reason);
      return;
    }
    failures.push(result.reason);
  });
  if (failures.length > 0) {
    throw moduleLoadFailure(failures, results.length);
  }
  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}

function validateModuleNameCollisions(entries: ModuleManifestEntry[]): void {
  const seenNames = new Set<string>();
  entries.forEach((entry) => {
    if (seenNames.has(entry.manifest.name)) {
      Logger.Error(
        `Detected module id collision (name in package.json): ${entry.manifest.name}`,
      );
      return;
    }
    seenNames.add(entry.manifest.name);
  });
}

export async function buildModuleConfigs(
  config: NormalizedLoadedConfig,
  loaderContext: LoaderContext,
): Promise<ModuleManifestEntry[]> {
  const moduleCount = Object.keys(config.modules).length;
  const modules = await runTask(
    "Loading modules",
    () => loadModuleEntries(config.modules, loaderContext),
    { done: `Loaded ${pluralize(moduleCount, "module")}` },
  );
  validateModuleNameCollisions(modules);
  return modules;
}

export function getWatchDirs(source: ModuleSource): string[] {
  if (source.type !== "local") {
    return [""];
  }

  const localSource = source as ModuleSourceLocal;
  if (Array.isArray(localSource.watchDir)) {
    return localSource.watchDir;
  }

  return localSource.watchDir ? [localSource.watchDir] : [""];
}

async function loadModuleManifestFromSource(
  loaderContext: LoaderContext,
  source: ModuleSource,
  moduleId: string,
  reload = false,
): Promise<ModuleManifest> {
  const manifests = await loaderContext.registry.load(
    loaderContext.projectFolder,
    loaderContext.cache,
    {
      ...source,
      id: moduleId,
    },
    { reload },
  );
  const [manifest] = manifests;
  if (!manifest) {
    throw new Error(
      `Failed to reload module ${moduleId}: no manifest returned`,
    );
  }
  return manifest;
}

function ensureReloadedModuleId(module: Module, moduleId: string): void {
  if (module.id !== moduleId) {
    throw new Error(
      `Reloaded module id mismatch: expected ${moduleId}, got ${module.id}`,
    );
  }
}

async function reloadLoadedModuleFromSource(
  manager: ModuleManager,
  loaderContext: LoaderContext,
  moduleId: string,
): Promise<void> {
  const entry = manager.getLoadedModuleEntry(moduleId);
  if (!entry) {
    return;
  }

  const previous = entry.module;
  const manifest = manager.placeModule(
    moduleId,
    await loadModuleManifestFromSource(
      loaderContext,
      previous.manifest.source,
      moduleId,
      true,
    ),
  );
  const replacement = new Module(manifest);
  try {
    ensureReloadedModuleId(replacement, moduleId);
    manager.checkReplacement(moduleId, replacement);
  } catch (error) {
    manager.discardPlacedModule(manifest);
    throw error;
  }
  const previousWasActive = previous.state === ModuleState.Active;
  try {
    await previous.destroy();
  } catch (error) {
    manager.discardPlacedModule(manifest);
    const recoveryErrors = await recoverPreviousModule(
      previous,
      previousWasActive,
    );
    throw new AggregateError(
      [...unpackErrors(error), ...recoveryErrors],
      `Failed to destroy module ${moduleId} during reload`,
    );
  }
  manager.unrequireModuleFiles(moduleId);
  await activateReplacement(manager, entry, replacement);
}

async function recoverPreviousModule(
  previous: Module,
  previousWasActive: boolean,
): Promise<unknown[]> {
  if (!previousWasActive || previous.state !== ModuleState.Constructed) {
    return [];
  }
  try {
    await previous.start();
    return [];
  } catch (error) {
    return [error];
  }
}

async function activateReplacement(
  manager: ModuleManager,
  entry: ManagedModule,
  replacement: Module,
): Promise<void> {
  let replacementInstalled = false;
  try {
    replacementInstalled = Boolean(
      manager.replaceLoadedModule(replacement.id, replacement),
    );
    if (!replacementInstalled) {
      throw new Error(`Failed to replace module ${replacement.id}`);
    }
    manager.refreshAssociations();
    await manager.constructModules([
      { module: replacement, config: entry.config },
    ]);
    await replacement.start();
  } catch (error) {
    const cleanupErrors = replacementInstalled
      ? await cleanupReplacement(replacement)
      : [];
    throw new AggregateError(
      [...unpackErrors(error), ...cleanupErrors],
      `Failed to activate replacement module ${replacement.id}`,
    );
  }
}

async function cleanupReplacement(replacement: Module): Promise<unknown[]> {
  try {
    await replacement.destroy();
    return [];
  } catch (error) {
    return unpackErrors(error);
  }
}

function unpackErrors(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors : [error];
}

export async function reloadWatchedModule(
  manager: ModuleManager,
  moduleId: string,
  loaderContext: LoaderContext,
): Promise<void> {
  await reloadLoadedModuleFromSource(manager, loaderContext, moduleId);
}

export async function loadModuleEntriesForManager(
  manager: ModuleManager,
  config: NormalizedLoadedConfig,
  runtimeInterface: boolean,
  loaderContext?: LoaderContext,
): Promise<ModuleManifestEntry[]> {
  const resolvedLoaderContext =
    loaderContext ?? (await createLoaderContext(config));
  if (runtimeInterface) {
    registerCoreModuleInterface(manager, async () => resolvedLoaderContext);
  }

  await registerCoreInterfaces(manager);
  const entries = await buildModuleConfigs(config, resolvedLoaderContext);
  manager.addModules(entries);
  return entries;
}

export async function constructModules(manager: ModuleManager): Promise<void> {
  Logger.Trace(`Constructing modules`);
  await runTask("Constructing modules", () => manager.constructAll(), {
    done: "Constructed modules",
    failed: "Failed to construct modules",
  });
}

export async function constructAndStartModules(
  manager: ModuleManager,
): Promise<void> {
  await constructModules(manager);
  await manager.startAll();
}

export async function destroyModulesAfterFailure(
  manager: ModuleManager,
  error: unknown,
): Promise<never> {
  try {
    await manager.destroyAll();
  } catch (cleanupError) {
    Logger.Error(
      "Failed to clean up modules after startup failure:",
      cleanupError,
    );
    throw new AggregateError(
      [...unpackErrors(error), ...unpackErrors(cleanupError)],
      "Failed to start and clean up modules",
    );
  }
  throw error;
}

function collectInterfaceProviders(
  manager: ModuleManager,
): InterfaceProvider[] {
  return manager.getAllManagedModules().map(({ module, config }) => ({
    name: module.manifest.manifest.name,
    implements: module.manifest.implements ?? [],
    disabledExports: config.disabledExports,
  }));
}

function collectStaticPackages(manager: ModuleManager): string[] {
  const loadedIds = new Set(
    [...manager.getLoadedModules()].map(({ module }) => module.id),
  );
  return manager
    .getAllManagedModules()
    .filter(({ module }) => !loadedIds.has(module.id))
    .flatMap(({ module }) => [
      module.manifest.manifest.name,
      ...Object.keys(module.manifest.manifest.dependencies ?? {}),
    ]);
}

function toInterfaceConsumer({ module }: ManagedModule): InterfaceConsumer {
  return {
    id: module.id,
    folder: module.manifest.folder,
    dependencies: module.manifest.manifest.dependencies ?? {},
    optionalDependencies: module.manifest.manifest.optionalDependencies ?? {},
  };
}

function unresolvedInterfacesError(unresolved: UnresolvedInterface[]): Error {
  const details = unresolved
    .map(
      ({ moduleId, interfacePackage }) =>
        `  - ${moduleId} requires ${interfacePackage}`,
    )
    .join("\n");
  return new Error(
    `Unresolved interface dependencies:\n${details}\n\nRun 'ajs project modules install' to resolve missing dependencies.`,
  );
}

/**
 * Checks that every interface `consumers` require is implemented by a module
 * the manager holds, them included, and tells which optional ones nothing
 * implements.
 *
 * @throws the "Unresolved interface dependencies" error naming each missing
 * interface and the module that requires it.
 */
function ensureInterfacesResolved(
  manager: ModuleManager,
  consumers: Iterable<ManagedModule>,
): InterfaceResolutionResult {
  const result = findUnresolvedInterfaces(
    collectInterfaceProviders(manager),
    [...consumers].map(toInterfaceConsumer),
    collectStaticPackages(manager),
  );
  if (result.unresolved.length > 0) {
    throw unresolvedInterfacesError(result.unresolved);
  }
  return result;
}

/**
 * Checks the interfaces of every loaded module at startup, and stubs the
 * optional ones nothing implements.
 */
export function ensureGraphIsValid(manager: ModuleManager): void {
  const { stubbed } = ensureInterfacesResolved(
    manager,
    manager.getLoadedModules(),
  );
  if (stubbed.length > 0) {
    manager.registerStubbedInterfaces(stubbed);
  }
}
