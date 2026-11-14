import type {
  ModuleSource,
  ModuleSourceGit,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import * as path from "node:path";
import { satisfies, valid, validRange } from "semver";

import { isObject, isString } from "../../utils";
import { ConfigLoader, findConfigPath, readEnvironmentNames } from "../config";
import type { NodeFileSystem } from "../filesystem";
import {
  type ModuleCache,
  ModuleLockStore,
  readBuildArtifact,
} from "../modules";

const Logger = new Logging.Channel("loader");

type CacheKeep = (entry: string, version: string) => boolean;

function isPackageSource(source: ModuleSource): source is ModuleSourcePackage {
  return source.type === "package";
}

function isGitSource(source: ModuleSource): source is ModuleSourceGit {
  return source.type === "git";
}

/**
 * Whether `spec` can load `version`: one in its range, or any version for a
 * dist-tag, which only the registry resolves and may move.
 */
function acceptsVersion(spec: string, version: string): boolean {
  const range = validRange(spec);
  return range === null || satisfies(version, range);
}

/** An entry of the layout before each version had its own folder, which no loader reads. */
function isOldLayout(entry: string, version: string): boolean {
  const exact = valid(version);
  return exact !== null && !entry.endsWith(`@${exact}`);
}

async function keepForSource(source: ModuleSource): Promise<CacheKeep> {
  const { packageCacheEntry, urlToFile } = await import("../downloaders");
  if (isPackageSource(source)) {
    return (entry, version) =>
      entry === packageCacheEntry(source.package, version) &&
      acceptsVersion(source.version, version);
  }
  if (isGitSource(source)) {
    const name = urlToFile(source.remote);
    return (entry) => entry === name;
  }
  return () => false;
}

/** The path of the test configuration the project's `package.json` names, if any. */
async function testConfigPath(
  projectFolder: string,
  fs: NodeFileSystem,
): Promise<string | undefined> {
  const packPath = path.join(projectFolder, "package.json");
  if (!(await fs.exists(packPath))) {
    return undefined;
  }
  const pack: unknown = JSON.parse(await fs.readFileString(packPath));
  const antelopeJs = isObject(pack) ? pack.antelopeJs : undefined;
  const test = isObject(antelopeJs) ? antelopeJs.test : undefined;
  return isString(test) ? path.resolve(projectFolder, test) : undefined;
}

/**
 * Every module source the project can load: each environment of its
 * configuration, and its test configuration. `undefined` when the
 * configuration accepts environment names it does not list.
 */
async function declaredSources(
  projectFolder: string,
  fs: NodeFileSystem,
): Promise<ModuleSource[] | undefined> {
  const environments = await readEnvironmentNames(
    await findConfigPath(projectFolder, fs),
  );
  if (environments === undefined) {
    return undefined;
  }
  const loader = new ConfigLoader(fs);
  const testPath = await testConfigPath(projectFolder, fs);
  const loaded = await Promise.all([
    ...environments.map((env) => loader.load(projectFolder, env)),
    ...(testPath === undefined
      ? []
      : [loader.load(projectFolder, undefined, testPath)]),
  ]);
  return loaded.flatMap((config) =>
    Object.values(config.modules).map(({ source }) => source),
  );
}

/** Keeps the version `antelope-lock` records for each locked package. */
async function keepLocked(
  projectFolder: string,
  fs: NodeFileSystem,
): Promise<CacheKeep> {
  const { packageCacheEntry } = await import("../downloaders");
  const locked = new Set(
    (await new ModuleLockStore(projectFolder, fs).list()).map((key) =>
      packageCacheEntry(key.package, key.version),
    ),
  );
  return (entry) => locked.has(entry);
}

/** Keeps the module folders the project's `build.json` points at; none without a build. */
async function keepBuilt(
  cache: ModuleCache,
  projectFolder: string,
  fs: NodeFileSystem,
): Promise<CacheKeep> {
  let folders: Set<string>;
  try {
    const artifact = await readBuildArtifact(projectFolder, fs);
    folders = new Set(
      Object.values(artifact.modules).map(({ folder }) => path.resolve(folder)),
    );
  } catch {
    folders = new Set();
  }
  return (entry) => folders.has(path.resolve(cache.path, entry));
}

/**
 * Removes the cached modules no run of the project can load: entries this run
 * did not load, that no environment or test configuration accepts, that no
 * lock records and that `build.json` does not point at. When the
 * configuration accepts environment names it does not list, it only removes
 * entries of the old layout. A failure is logged, never thrown, since the
 * modules have already loaded.
 */
export async function pruneModuleCache(
  cache: ModuleCache,
  projectFolder: string,
  fs: NodeFileSystem,
): Promise<void> {
  try {
    const sources = await declaredSources(projectFolder, fs);
    if (sources === undefined) {
      await cache.prune((entry, version) => !isOldLayout(entry, version));
      return;
    }
    const keeps = await Promise.all([
      ...sources.map(keepForSource),
      keepLocked(projectFolder, fs),
      keepBuilt(cache, projectFolder, fs),
    ]);
    await cache.prune((entry, version) =>
      keeps.some((keep) => keep(entry, version)),
    );
  } catch (err) {
    Logger.Warn("Could not remove unused modules from the cache:", err);
  }
}
