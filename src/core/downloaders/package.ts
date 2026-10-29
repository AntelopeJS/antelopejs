import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import * as path from "node:path";
import { maxSatisfying, satisfies, valid, validRange } from "semver";

import type { IFileSystem } from "../../types";
import { NodeFileSystem } from "../filesystem";
import {
  ModuleCache,
  ModuleManifest,
  type ModulePackageJson,
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

interface InlyExtraction {
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "end", listener: () => void): void;
}

const inly: (from: string, to: string) => InlyExtraction = require("inly");

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

function pickBestVersion(versions: string[], spec: string): string | undefined {
  const range = validRange(spec);
  if (range) {
    return maxSatisfying(versions, range) ?? undefined;
  }
  return versions[versions.length - 1];
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
    const parsed: string | string[] = JSON.parse(output);
    const versions = Array.isArray(parsed) ? parsed : [parsed];
    return pickBestVersion(versions, spec);
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

function cacheSatisfiesSpec(cached: string, spec: string): boolean {
  const range = validRange(spec);
  return range === null || satisfies(cached, range);
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
  const cached = cache.getVersion(source.package);
  if (cached && cacheSatisfiesSpec(cached, source.version)) {
    if (validRange(source.version) === null) {
      Logger.Warn(
        `Registry unreachable, serving last cached ${source.package}@${cached} for tag '${source.version}' (cannot verify it is current)`,
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

async function findCachedFolder(
  cache: ModuleCache,
  pkg: string,
  fs: IFileSystem,
): Promise<string | undefined> {
  const folder = await cache.getFolder(pkg, true, true);
  const manifestPath = path.join(folder, PACKAGE_JSON);
  if (!(await fs.exists(manifestPath))) {
    return undefined;
  }
  try {
    const manifest: ModulePackageJson = JSON.parse(
      await fs.readFileString(manifestPath),
    );
    const hasDependencies = Object.keys(manifest.dependencies ?? {}).length > 0;
    if (
      hasDependencies &&
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
  const manifest: ModulePackageJson = JSON.parse(
    await ctx.fs.readFileString(path.join(tmpPackage, PACKAGE_JSON)),
  );
  const key = { package: source.package, version: manifest.version };
  const record = await ctx.locks.find(key);
  Logger.Trace(`Transferring ${source.package}@${version} to cache`);
  await cache.clearVersion(source.package);
  const folder = await cache.transfer(tmpPackage, source.package);
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
  await cache.commitVersion(source.package, manifest.version);
  await ctx.locks.keep(key, folder, record);
  return folder;
}

async function loadPackage(
  cache: ModuleCache,
  source: ModuleSourcePackage,
  ctx: PackageLoaderContext,
  fetchVersion: VersionFetcher,
): Promise<string> {
  if (source.ignoreCache) {
    return downloadPackage(cache, source, source.version, ctx);
  }
  const target =
    (await ctx.locks.recordedVersion(source)) ??
    (await resolveTargetVersion(source, cache, fetchVersion));
  const key = { package: source.package, version: target };
  const record = await ctx.locks.find(key);
  if (ctx.locks.reusesCache && cache.hasVersion(source.package, target)) {
    const cachedFolder = await findCachedFolder(cache, source.package, ctx.fs);
    if (cachedFolder && (await ctx.locks.matches(cachedFolder, record))) {
      Logger.Trace(`Using cached version of ${source.package}@${target}`);
      await ctx.locks.keep(key, cachedFolder, record);
      return cachedFolder;
    }
  }
  return downloadPackage(cache, source, target, ctx);
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

  registry.register(
    "package",
    "package",
    async (cache: ModuleCache, source: ModuleSourcePackage) => {
      Logger.Debug(`Loading package: ${source.package}@${source.version}`);
      const folder = await loadPackage(cache, source, ctx, fetchVersion);
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
