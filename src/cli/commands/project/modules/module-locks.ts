import type {
  AntelopeConfig,
  ModuleSource,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import path from "node:path";

import { ConfigLoader } from "../../../../core/config";
import {
  DownloaderRegistry,
  registerGitDownloader,
  registerLocalDownloader,
  registerLocalFolderDownloader,
  registerPackageDownloader,
} from "../../../../core/downloaders";
import { NodeFileSystem } from "../../../../core/filesystem";
import {
  ModuleCache,
  ModuleLockStore,
  type ModuleLockChange,
  type ModuleLockKey,
  type ModuleLockMode,
  type ModuleLockRequirement,
} from "../../../../core/modules";
import {
  ExecuteCMD,
  getProcessPalette,
  getProcessUi,
  runTask,
} from "../../../../core/output";
import { listKnownEnvironments } from "../../shared/project-command";

const PACKAGE_SOURCE_TYPE = "package";
const DEFAULT_CACHE_FOLDER = ".antelope/cache";

/** A package module whose lock `modules update` resolves again. */
export interface LockedModule {
  id: string;
  source: ModuleSourcePackage;
}

function isPackageSource(
  source: ModuleSource | undefined,
): source is ModuleSourcePackage {
  return source?.type === PACKAGE_SOURCE_TYPE;
}

/**
 * The downloaders a modules command loads modules with. Package modules use
 * the project's module locks in `mode`.
 */
export function createModuleRegistry(
  project: string,
  mode: ModuleLockMode,
  fs: NodeFileSystem = new NodeFileSystem(),
): DownloaderRegistry {
  const registry = new DownloaderRegistry();
  registerLocalDownloader(registry, { fs, exec: ExecuteCMD });
  registerLocalFolderDownloader(registry, { fs });
  registerPackageDownloader(registry, {
    fs,
    exec: ExecuteCMD,
    lock: { store: new ModuleLockStore(project, fs), mode },
  });
  registerGitDownloader(registry, { fs, exec: ExecuteCMD });
  return registry;
}

/** The module cache of the project, loaded. */
export async function openModuleCache(
  project: string,
  config: AntelopeConfig,
): Promise<ModuleCache> {
  const cacheFolder = config.cacheFolder ?? DEFAULT_CACHE_FOLDER;
  const cache = new ModuleCache(path.resolve(project, cacheFolder));
  await cache.load();
  return cache;
}

async function environmentRequirements(
  loader: ConfigLoader,
  project: string,
  env: string,
): Promise<ModuleLockRequirement[]> {
  const loaded = await loader.load(project, env);
  return Object.values(loaded.modules).flatMap(({ source }) =>
    isPackageSource(source)
      ? [{ package: source.package, spec: source.version }]
      : [],
  );
}

/**
 * Removes the module locks that no environment of the project uses any
 * more, and prints one line per removed lock.
 */
export async function pruneModuleLocks(
  project: string,
  config: AntelopeConfig,
): Promise<ModuleLockKey[]> {
  const loader = new ConfigLoader(new NodeFileSystem());
  const requirements = await Promise.all(
    listKnownEnvironments(config).map((env) =>
      environmentRequirements(loader, project, env),
    ),
  );
  const removed = await new ModuleLockStore(project).prune(requirements.flat());
  removed.forEach((key) =>
    getProcessUi().message(
      "success",
      `Removed ${ModuleLockStore.relativePath(key)}: no environment uses it`,
    ),
  );
  return removed;
}

interface RefreshedLock {
  key: ModuleLockKey;
  change: ModuleLockChange | "missing";
}

/** Whether `modules update` wrote a new or different lock for the module. */
export function isChangedLock(refreshed: RefreshedLock): boolean {
  return refreshed.change === "added" || refreshed.change === "changed";
}

async function recordedContents(
  store: ModuleLockStore,
  pkg: string,
): Promise<Map<string, string>> {
  const versions = await store.versions(pkg);
  const records = await Promise.all(
    versions.map((version) => store.read({ package: pkg, version })),
  );
  const contents = new Map<string, string>();
  records.forEach((record) => {
    if (record) {
      contents.set(record.version, record.content);
    }
  });
  return contents;
}

function describeChange(
  previous: string | undefined,
  current: string | undefined,
): RefreshedLock["change"] {
  if (current === undefined) {
    return "missing";
  }
  if (previous === undefined) {
    return "added";
  }
  return previous === current ? "unchanged" : "changed";
}

async function refreshModuleLock(
  context: {
    project: string;
    cache: ModuleCache;
    registry: DownloaderRegistry;
  },
  module: LockedModule,
): Promise<RefreshedLock> {
  const store = new ModuleLockStore(context.project);
  const before = await recordedContents(store, module.source.package);
  const [manifest] = await context.registry.load(
    context.project,
    context.cache,
    { ...module.source, id: module.id },
  );
  const key = {
    package: module.source.package,
    version: manifest.manifest.version,
  };
  const after = await store.read(key);
  return {
    key,
    change: describeChange(before.get(key.version), after?.content),
  };
}

function reportRefreshedLock({ key, change }: RefreshedLock): void {
  const ui = getProcessUi();
  const lock = getProcessPalette().bold(ModuleLockStore.relativePath(key));
  if (change === "missing") {
    ui.message(
      "warn",
      `No lockfile to record for ${key.package}@${key.version}`,
    );
    return;
  }
  ui.message(change === "unchanged" ? "info" : "success", `${lock} ${change}`);
}

/**
 * Downloads `modules` again, resolves their dependencies from the registry
 * without their recorded locks, and records the lockfiles they get.
 */
export async function refreshModuleLocks(
  project: string,
  config: AntelopeConfig,
  modules: LockedModule[],
): Promise<RefreshedLock[]> {
  if (modules.length === 0) {
    return [];
  }
  const context = {
    project,
    cache: await openModuleCache(project, config),
    registry: createModuleRegistry(project, "refresh"),
  };
  const refreshed = await runTask(
    "Resolving module dependencies",
    () =>
      Promise.all(modules.map((module) => refreshModuleLock(context, module))),
    { done: "Resolved module dependencies" },
  );
  refreshed.forEach(reportRefreshedLock);
  return refreshed;
}
