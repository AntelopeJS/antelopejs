import type {
  ModuleSource,
  ModuleSourceGit,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import * as path from "node:path";
import { maxSatisfying, validRange } from "semver";

import {
  ConfigLoader,
  DEFAULT_ENV,
  findConfigPath,
  loadTsConfigFile,
} from "../config";
import type { NodeFileSystem } from "../filesystem";
import { type ModuleCache, readBuildArtifact } from "../modules";

const Logger = new Logging.Channel("loader");

type CacheKeep = (entry: string, version: string) => boolean;

function isPackageSource(source: ModuleSource): source is ModuleSourcePackage {
  return source.type === "package";
}

function isGitSource(source: ModuleSource): source is ModuleSourceGit {
  return source.type === "git";
}

/**
 * The cached version an offline start of `source` falls back to: the highest
 * one in its range, or the highest one for a dist-tag, which only the registry
 * resolves.
 */
async function fallbackEntry(
  source: ModuleSourcePackage,
  cache: ModuleCache,
): Promise<string | undefined> {
  const { packageCacheEntry } = await import("../downloaders");
  const versions = cache
    .entries()
    .filter(
      ([entry, version]) =>
        entry === packageCacheEntry(source.package, version),
    )
    .map(([, version]) => version);
  const best = maxSatisfying(versions, validRange(source.version) ?? "*");
  return best === null ? undefined : packageCacheEntry(source.package, best);
}

async function keepForSource(
  source: ModuleSource,
  cache: ModuleCache,
): Promise<CacheKeep> {
  const { urlToFile } = await import("../downloaders");
  if (isPackageSource(source)) {
    const kept = await fallbackEntry(source, cache);
    return (entry) => entry === kept;
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

/** The cache entries the project's `build.json` points at; none without a build. */
async function builtEntries(
  cache: ModuleCache,
  projectFolder: string,
  fs: NodeFileSystem,
): Promise<string[]> {
  try {
    const artifact = await readBuildArtifact(projectFolder, fs);
    return Object.values(artifact.modules).map(({ folder }) =>
      path.relative(cache.path, folder),
    );
  } catch {
    return [];
  }
}

/**
 * Removes the cached modules that this run did not load, that `build.json`
 * does not point at, and that no environment the configuration lists falls
 * back to offline. A failure is logged, never thrown, since the
 * modules have already loaded.
 */
export async function pruneModuleCache(
  cache: ModuleCache,
  projectFolder: string,
  fs: NodeFileSystem,
): Promise<void> {
  try {
    const keeps = await Promise.all(
      (await declaredSources(projectFolder, fs)).map((source) =>
        keepForSource(source, cache),
      ),
    );
    const built = new Set(await builtEntries(cache, projectFolder, fs));
    await cache.prune(
      (entry, version) =>
        built.has(entry) || keeps.some((keep) => keep(entry, version)),
    );
  } catch (err) {
    Logger.Warn("Could not remove unused modules from the cache:", err);
  }
}
