import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import inly = require("inly");
import * as path from "node:path";
import { maxSatisfying, sort, valid, validRange } from "semver";

import type { IFileSystem } from "../../types";
import { isObject, isString } from "../../utils";
import { NodeFileSystem } from "../filesystem";
import {
  ModuleCache,
  type ModuleLockKey,
  type ModuleLockRecord,
  ModuleManifest,
} from "../modules";
import { ExecError, ExecuteCMD, getModuleCacheInstallCommand } from "../output";
import { type PackageLockPolicy, PackageLocks } from "./package-locks";
import type { DownloaderRegistry } from "./registry";
import type { CommandRunner } from "./types";
import { installFailure } from "./utils";

export interface PackageDownloaderDeps {
  fs?: IFileSystem;
  exec?: CommandRunner;
  extract?: (from: string, to: string) => Promise<void>;
  getInstallCommand?: (folder: string) => Promise<string>;
  getTemp?: () => Promise<string>;
  /** Module locks of the project to replay and record; none by default. */
  lock?: PackageLockPolicy;
}

type PackageLoaderContext = Required<Omit<PackageDownloaderDeps, "lock">> & {
  locks: PackageLocks;
};

type VersionFetcher = (
  pkg: string,
  spec: string,
) => Promise<string | undefined>;

const Logger = new Logging.Channel("loader.package");

const PACKAGE_JSON = "package.json";
const NODE_MODULES = "node_modules";

function defaultExtract(from: string, to: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const instance = inly(from, to);
    instance.on("error", reject);
    instance.on("end", resolve);
  });
}

function isExactVersion(spec: string): boolean {
  return valid(spec) !== null;
}

function isExactVersionString(value: unknown): value is string {
  return isString(value) && isExactVersion(value);
}

/** The exact versions of an `npm view <pkg>@<spec> version --json` answer, which prints one version or a list of them. */
function decodeViewVersions(output: string): string[] {
  const parsed: unknown = JSON.parse(output);
  const answers: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  return answers.filter(isExactVersionString);
}

/** The `version` of a packed package.json, or `undefined` when it holds no exact version. */
function decodePackedVersion(packageJsonText: string): string | undefined {
  const parsed: unknown = JSON.parse(packageJsonText);
  return isObject(parsed) && isExactVersionString(parsed.version)
    ? parsed.version
    : undefined;
}

function pickBestVersion(versions: string[], spec: string): string | undefined {
  const range = validRange(spec);
  if (range) {
    return maxSatisfying(versions, range) ?? undefined;
  }
  const last = versions[versions.length - 1];
  return spec === "latest" ? (maxSatisfying(versions, "*") ?? last) : last;
}

async function fetchRegistryVersion(
  pkg: string,
  spec: string,
  exec: CommandRunner,
): Promise<string | undefined> {
  let output: string;
  try {
    const result = await exec(`npm view "${pkg}@${spec}" version --json`, {});
    if (result.code !== 0) {
      return undefined;
    }
    output = result.stdout.trim();
  } catch {
    return undefined;
  }
  if (!output) {
    return undefined;
  }
  try {
    return pickBestVersion(decodeViewVersions(output), spec);
  } catch {
    Logger.Debug(`Unexpected npm view output for ${pkg}@${spec}: ${output}`);
    return undefined;
  }
}

function memoizeVersionFetcher(exec: CommandRunner): VersionFetcher {
  const pending = new Map<string, Promise<string | undefined>>();
  return (pkg, spec) => {
    const key = `${pkg}@${spec}`;
    const existing = pending.get(key);
    if (existing) {
      return existing;
    }
    const created = fetchRegistryVersion(pkg, spec, exec);
    pending.set(key, created);
    return created;
  };
}

/**
 * Runs the loads of one package one after another. The version a load
 * installs is only known once it runs, so a second load of the same version
 * waits for the first and then reuses what it installed.
 */
function queuePerPackage(): (
  key: string,
  load: () => Promise<string>,
) => Promise<string> {
  const tails = new Map<string, Promise<unknown>>();
  return (key, load) => {
    const loaded = (tails.get(key) ?? Promise.resolve()).then(load);
    const tail = loaded.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) {
        tails.delete(key);
      }
    });
    return loaded;
  };
}

/** `version` spelled as the cache spells it: `v1.0.0` as `1.0.0`. */
function cachedVersionOf(version: string): string {
  return valid(version) ?? version;
}

/** The cache entry, and folder, that holds one version of a package. */
function cacheEntry(pkg: string, version: string): string {
  return `${pkg}@${cachedVersionOf(version)}`;
}

/** The versions of a package the cache holds, lowest first. */
function cachedVersions(cache: ModuleCache, pkg: string): string[] {
  return sort(
    cache
      .entries()
      .filter(([entry, version]) => entry === cacheEntry(pkg, version))
      .map(([, version]) => version),
  );
}

async function resolveTargetVersion(
  source: ModuleSourcePackage,
  cache: ModuleCache,
  fetchVersion: VersionFetcher,
): Promise<string> {
  if (isExactVersion(source.version)) {
    return source.version;
  }
  const resolved = await fetchVersion(source.package, source.version);
  if (resolved) {
    Logger.Debug(`Resolved ${source.package}@${source.version} to ${resolved}`);
    return resolved;
  }
  const cached = pickBestVersion(
    cachedVersions(cache, source.package),
    source.version,
  );
  if (cached) {
    if (validRange(source.version) === null) {
      Logger.Warn(
        `Registry unreachable, serving cached ${source.package}@${cached} for tag '${source.version}' (cannot verify it is current)`,
      );
    } else {
      Logger.Debug(
        `Registry unreachable, keeping cached ${source.package}@${cached}`,
      );
    }
    return cached;
  }
  throw new Error(
    `Failed to resolve version '${source.version}' of package ${source.package} from the npm registry`,
  );
}

/** The number of dependencies a cached package.json declares, or `undefined` when its shape is not a manifest. */
function countDeclaredDependencies(text: string): number | undefined {
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed)) {
    return undefined;
  }
  const { dependencies } = parsed;
  if (dependencies === undefined || dependencies === null) {
    return 0;
  }
  return isObject(dependencies) ? Object.keys(dependencies).length : undefined;
}

async function findCachedFolder(
  cache: ModuleCache,
  entry: string,
  fs: IFileSystem,
): Promise<string | undefined> {
  const folder = await cache.getFolder(entry, true, true);
  const manifestPath = path.join(folder, PACKAGE_JSON);
  if (!(await fs.exists(manifestPath))) {
    return undefined;
  }
  try {
    const dependencyCount = countDeclaredDependencies(
      await fs.readFileString(manifestPath),
    );
    if (dependencyCount === undefined) {
      return undefined;
    }
    if (
      dependencyCount > 0 &&
      !(await fs.exists(path.join(folder, NODE_MODULES)))
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return folder;
}

async function downloadPackage(
  cache: ModuleCache,
  source: ModuleSourcePackage,
  version: string,
  ctx: PackageLoaderContext,
): Promise<string> {
  Logger.Trace(`Downloading package ${source.package}@${version}`);
  const tmp = await ctx.getTemp();
  const packCommand = `npm pack "${source.package}@${version}"`;
  const result = await ctx.exec(packCommand, { cwd: tmp });
  if (result.code !== 0) {
    throw new ExecError({ ...result, command: packCommand });
  }
  const packOutput = result.stdout.trim().split("\n");
  const filename = packOutput[packOutput.length - 1].trim();

  Logger.Debug(`Extracting ${filename} for ${source.package}@${version}`);
  await ctx.extract(path.join(tmp, filename), tmp);

  const tmpPackage = path.join(tmp, "package");
  const packedVersion = decodePackedVersion(
    await ctx.fs.readFileString(path.join(tmpPackage, PACKAGE_JSON)),
  );
  const key = { package: source.package, version: packedVersion ?? version };
  const entry = cacheEntry(key.package, key.version);
  const requested = cacheEntry(source.package, version);
  if (entry !== requested) {
    await ctx.fs.rm(tmp, { recursive: true, force: true });
    throw new Error(
      `${packCommand} returned version ${key.version}, not the ${requested} this run downloads; check the registry`,
    );
  }
  const record = await ctx.locks.find(key);
  Logger.Trace(`Transferring ${source.package}@${version} to cache`);
  const folder = await cache.transfer(tmpPackage, entry);
  await ctx.locks.replay(folder, record);

  Logger.Debug(`Installing dependencies for ${source.package}@${version}`);
  const cmd = await ctx.getInstallCommand(folder);
  const installResult = await ctx.exec(cmd, { cwd: folder });
  if (installResult.code !== 0) {
    throw installFailure(
      `${source.package}@${version}`,
      new ExecError({ ...installResult, command: cmd }),
    );
  }
  if (packedVersion !== undefined) {
    await cache.commitVersion(entry, packedVersion);
  }
  await ctx.locks.keep(key, folder, record);
  return folder;
}

/**
 * One load of a package at one exact version: its source, the lock key of
 * that version, its cache entry, and the lock record it installs from.
 */
interface PackageLoad {
  cache: ModuleCache;
  source: ModuleSourcePackage;
  key: ModuleLockKey;
  entry: string;
  record: ModuleLockRecord | undefined;
}

/**
 * The folder the manifest lists for the version of `load`, when it is
 * complete and installed from the lock record the mode requires. A refresh,
 * or a source that ignores the cache, reuses none.
 */
async function findListedFolder(
  load: PackageLoad,
  ctx: PackageLoaderContext,
): Promise<string | undefined> {
  const { cache, source, key, entry, record } = load;
  if (
    source.ignoreCache ||
    !ctx.locks.reusesCache ||
    !cache.hasVersion(entry, key.version)
  ) {
    return undefined;
  }
  const folder = await findCachedFolder(cache, entry, ctx.fs);
  if (folder === undefined || !(await ctx.locks.matches(folder, record))) {
    return undefined;
  }
  Logger.Trace(`Using cached version of ${source.package}@${key.version}`);
  return folder;
}

/**
 * The complete folder of the version of `load` that the live run of another
 * process uses, so that this run keeps it as it is instead of replacing it.
 * The manifest lists it again when it lost it.
 */
async function findFolderInUse(
  load: PackageLoad,
  ctx: PackageLoaderContext,
): Promise<string | undefined> {
  const { cache, key, entry, record } = load;
  const holder = await cache.findOtherLease(entry);
  if (holder === undefined) {
    return undefined;
  }
  const folder = await findCachedFolder(cache, entry, ctx.fs);
  if (folder === undefined) {
    return undefined;
  }
  if (
    ctx.locks.isFrozen &&
    record !== undefined &&
    !(await ctx.locks.matches(folder, record))
  ) {
    throw new Error(
      `${entry} was installed from another ${record.lockfile} than its lock, and the run with pid ${holder.pid} on ${holder.host} uses it (lease ${holder.file}), so the frozen install cannot replace it. Stop that run, then try again. If that run is gone, delete ${holder.file}.`,
    );
  }
  Logger.Info(
    `${entry} is in use by the run with pid ${holder.pid} on ${holder.host} (lease ${holder.file}); keeping its folder instead of downloading it again`,
  );
  if (cache.getVersion(entry) === undefined) {
    await cache.commitVersion(entry, cachedVersionOf(key.version));
  }
  return folder;
}

/**
 * Loads `load` while this run holds its download lock. It reads the manifest
 * again, since another run may have just downloaded the version, then reuses
 * the folder the manifest lists, or else a complete folder that another live
 * run uses, and downloads the version otherwise. It records the lockfile of
 * the folder it returns.
 */
async function loadUnderDownloadLock(
  load: PackageLoad,
  ctx: PackageLoaderContext,
): Promise<string> {
  const { cache, source, key, record } = load;
  await cache.load();
  const reused =
    (await findListedFolder(load, ctx)) ?? (await findFolderInUse(load, ctx));
  if (reused === undefined) {
    return downloadPackage(cache, source, key.version, ctx);
  }
  await ctx.locks.keep(key, reused, record);
  return reused;
}

async function loadPackage(
  cache: ModuleCache,
  source: ModuleSourcePackage,
  ctx: PackageLoaderContext,
  fetchVersion: VersionFetcher,
): Promise<string> {
  const target =
    (await ctx.locks.recordedVersion(source)) ??
    (await resolveTargetVersion(source, cache, fetchVersion));
  const key = { package: source.package, version: target };
  const entry = cacheEntry(source.package, target);
  const record = await ctx.locks.find(key);
  return cache.withDownloadLock(entry, () =>
    loadUnderDownloadLock({ cache, source, key, entry, record }, ctx),
  );
}

export function registerPackageDownloader(
  registry: DownloaderRegistry,
  deps: PackageDownloaderDeps = {},
): void {
  const fs = deps.fs ?? new NodeFileSystem();
  const ctx: PackageLoaderContext = {
    fs,
    exec: deps.exec ?? ExecuteCMD,
    extract: deps.extract ?? defaultExtract,
    getInstallCommand: deps.getInstallCommand ?? getModuleCacheInstallCommand,
    getTemp: deps.getTemp ?? (() => ModuleCache.getTemp()),
    locks: new PackageLocks(deps.lock, fs),
  };
  const fetchVersion = memoizeVersionFetcher(ctx.exec);
  const queue = queuePerPackage();

  registry.register(
    "package",
    "package",
    async (cache: ModuleCache, source: ModuleSourcePackage) => {
      Logger.Debug(`Loading package: ${source.package}@${source.version}`);
      const folder = await queue(path.join(cache.path, source.package), () =>
        loadPackage(cache, source, ctx, fetchVersion),
      );
      Logger.Debug(`Successfully loaded ${source.package}@${source.version}`);
      const name = source.id ?? source.package;
      const moduleManifest = await ModuleManifest.create(
        folder,
        source,
        name,
        ctx.fs,
      );
      return [moduleManifest];
    },
  );
}
