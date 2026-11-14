import type {
  ModuleSource,
  ModuleSourceGit,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import { satisfies, validRange } from "semver";

import {
  ConfigLoader,
  DEFAULT_ENV,
  findConfigPath,
  loadTsConfigFile,
} from "../config";
import type { NodeFileSystem } from "../filesystem";
import type { ModuleCache } from "../modules";

const Logger = new Logging.Channel("loader");

type CacheKeep = (entry: string, version: string) => boolean;

function isPackageSource(source: ModuleSource): source is ModuleSourcePackage {
  return source.type === "package";
}

function isGitSource(source: ModuleSource): source is ModuleSourceGit {
  return source.type === "git";
}

/**
 * Whether the cache entry holds a version `spec` can load: one in its range,
 * or any version when `spec` is a dist-tag, which only the registry resolves.
 */
function satisfiesSpec(version: string, spec: string): boolean {
  const range = validRange(spec);
  return range === null || satisfies(version, range);
}

async function keepForSource(source: ModuleSource): Promise<CacheKeep> {
  const { packageCacheEntry, urlToFile } = await import("../downloaders");
  if (isPackageSource(source)) {
    return (entry, version) =>
      entry === packageCacheEntry(source.package, version) &&
      satisfiesSpec(version, source.version);
  }
  if (isGitSource(source)) {
    const name = urlToFile(source.remote);
    return (entry) => entry === name;
  }
  return () => false;
}

async function declaredSources(
  projectFolder: string,
  fs: NodeFileSystem,
): Promise<ModuleSource[]> {
  const raw = await loadTsConfigFile(
    await findConfigPath(projectFolder, fs),
    undefined,
    true,
  );
  const environments = [DEFAULT_ENV, ...Object.keys(raw.environments ?? {})];
  const loader = new ConfigLoader(fs);
  const loaded = await Promise.all(
    environments.map((env) => loader.load(projectFolder, env)),
  );
  return loaded.flatMap((config) =>
    Object.values(config.modules).map(({ source }) => source),
  );
}

/**
 * Removes the cached modules that no environment of the project declares and
 * that this run did not load. A failure is logged, never thrown, since the
 * modules have already loaded.
 */
export async function pruneModuleCache(
  cache: ModuleCache,
  projectFolder: string,
  fs: NodeFileSystem,
): Promise<void> {
  try {
    const keeps = await Promise.all(
      (await declaredSources(projectFolder, fs)).map(keepForSource),
    );
    await cache.prune((entry, version) =>
      keeps.some((keep) => keep(entry, version)),
    );
  } catch (err) {
    Logger.Warn("Could not remove unused modules from the cache:", err);
  }
}
