import type {
  ModuleSource,
  ModuleSourceLocal,
} from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";

import type { ExpandedModuleConfig } from "../config";
import { NodeFileSystem } from "../filesystem";
import type { ModuleConfig, ModuleManager } from "../modules";
import { ModuleCache, ModuleManifest, unpackErrors } from "../modules";
import { pluralize, runTask } from "../output";
import {
  registerCoreInterfaces,
  registerCoreModuleInterface,
} from "./core-module-interface";
import { moduleLoadFailure } from "./module-load-failure";
import type {
  LoaderConfig,
  LoaderContext,
  ModuleManifestEntry,
  ModuleOverrideMap,
  NormalizedLoadedConfig,
} from "./runtime-types";
export {
  registerCoreInterfaces,
  registerCoreModuleInterface,
} from "./core-module-interface";
export { activateLoadedModules, ensureGraphIsValid } from "./module-interfaces";
export { reloadWatchedModule } from "./module-reloading";

const Logger = new Logging.Channel("loader");

export async function createLoaderContext(
  config: LoaderConfig,
  fs: NodeFileSystem = new NodeFileSystem(),
): Promise<LoaderContext> {
  const [{ DownloaderRegistry }, git, local, localFolder, packageDownloader] =
    await Promise.all([
      import("../downloaders").then((entry) => entry.registryModule),
      import("../downloaders").then((entry) => entry.gitModule),
      import("../downloaders").then((entry) => entry.localModule),
      import("../downloaders").then((entry) => entry.localFolderModule),
      import("../downloaders").then((entry) => entry.packageModule),
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

/**
 * Logs that optional module `id` could not be downloaded: the project starts
 * without it.
 */
function skipOptionalModule(
  id: string,
  reason: PromiseRejectedResult["reason"],
): void {
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

  const localSource: ModuleSource & Pick<ModuleSourceLocal, "watchDir"> =
    source;
  if (Array.isArray(localSource.watchDir)) {
    return localSource.watchDir;
  }

  return localSource.watchDir ? [localSource.watchDir] : [""];
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Exported cleanup rethrows the original arbitrary startup failure by identity, or includes it in an AggregateError.
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
