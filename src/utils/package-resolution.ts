import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { isObject } from "./object";
import { isString } from "./type-guards";

export interface ResolvedPackage {
  name: string;
  version: string | undefined;
  root: string;
  realRoot: string;
  entry: string;
  resolveFrom: string;
  antelopeJs?: { implements?: unknown; standalone?: unknown };
}

export type PathMatcher = (filePath: string) => boolean;

interface PackageJson {
  name?: string;
  version?: string;
  antelopeJs?: ResolvedPackage["antelopeJs"];
}

const realPathCache = new Map<string, string>();
const pathVariantsCache = new Map<string, string[]>();
let pathCacheGeneration = 0;

/**
 * Forgets every cached `realpath` lookup.
 *
 * Call it whenever the file layout may have changed on disk (a module was
 * installed, reinstalled or reloaded), so symlinks are resolved again.
 */
export function clearPathResolutionCache(): void {
  realPathCache.clear();
  pathVariantsCache.clear();
  pathCacheGeneration += 1;
}

/**
 * Increases each time the `realpath` cache is cleared, so derived caches can
 * tell they are stale.
 */
export function getPathResolutionCacheGeneration(): number {
  return pathCacheGeneration;
}

/**
 * The real path of `filePath`, or its resolved path when it does not exist.
 * Lookups are cached until `clearPathResolutionCache`.
 *
 * It is the path the module loader names the file by, so it matches the
 * `require.cache` keys and module filenames: on Windows the loader keeps
 * 8.3 short names such as `RUNNER~1`, which the native realpath expands.
 */
export function normalizeExistingPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  const cachedPath = realPathCache.get(resolvedPath);
  if (cachedPath !== undefined) {
    return cachedPath;
  }
  try {
    const realPath = realpathSync(resolvedPath);
    realPathCache.set(resolvedPath, realPath);
    return realPath;
  } catch {
    return resolvedPath;
  }
}

const POSIX_SEP = "/";

/**
 * The resolved path of `filePath` and, when it differs, its real path.
 *
 * The result is shared between calls and must not be modified. It is reused
 * only for an absolute POSIX path that exists, because that is the only input
 * whose resolution cannot change before `clearPathResolutionCache`: a relative
 * path follows the working directory, and a missing path may appear on disk.
 */
export function getPathVariants(filePath: string): string[] {
  const reusable = path.sep === POSIX_SEP && filePath.startsWith(POSIX_SEP);
  const cachedVariants = reusable ? pathVariantsCache.get(filePath) : undefined;
  if (cachedVariants) {
    return cachedVariants;
  }
  const logicalPath = path.resolve(filePath);
  const realPath = normalizeExistingPath(logicalPath);
  const variants =
    logicalPath === realPath ? [logicalPath] : [logicalPath, realPath];
  if (reusable && realPathCache.has(logicalPath)) {
    pathVariantsCache.set(filePath, variants);
  }
  return variants;
}

function isVariantWithin(fileVariant: string, folderVariant: string): boolean {
  if (path.sep === POSIX_SEP) {
    return (
      fileVariant === folderVariant ||
      fileVariant.startsWith(
        folderVariant.endsWith(POSIX_SEP)
          ? folderVariant
          : `${folderVariant}${POSIX_SEP}`,
      )
    );
  }
  const relativePath = path.relative(folderVariant, fileVariant);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

/**
 * Whether any file variant lies inside any folder variant. Both lists must come
 * from `getPathVariants`, so every entry is a resolved absolute path.
 */
export function areVariantsWithin(
  fileVariants: readonly string[],
  folderVariants: readonly string[],
): boolean {
  return fileVariants.some((fileVariant) =>
    folderVariants.some((folderVariant) =>
      isVariantWithin(fileVariant, folderVariant),
    ),
  );
}

/**
 * Builds a reusable test for "is this file inside `folderPath`", resolving
 * the folder's path variants once instead of on every call.
 */
export function createPathWithinMatcher(folderPath: string): PathMatcher {
  const folderVariants = getPathVariants(folderPath);
  return (filePath) =>
    areVariantsWithin(getPathVariants(filePath), folderVariants);
}

const PRESERVE_SYMLINKS_FLAG = "--preserve-symlinks";

function isPreserveSymlinksFlag(argument: string): boolean {
  const [name] = argument.split("=", 1);
  return name.replaceAll("_", "-") === PRESERVE_SYMLINKS_FLAG;
}

function loaderPreservesSymlinks(): boolean {
  return (
    process.env.NODE_PRESERVE_SYMLINKS === "1" ||
    process.execArgv.some(isPreserveSymlinksFlag) ||
    (process.env.NODE_OPTIONS ?? "").split(/\s+/).some(isPreserveSymlinksFlag)
  );
}

/**
 * {@link createPathWithinMatcher} for the keys of `require.cache`. The module
 * loader already names each loaded file by its real path, the one
 * `normalizeExistingPath` returns, so the file side is not resolved again:
 * a scan of the cache costs no filesystem call per loaded file. Under
 * `--preserve-symlinks` the loader keeps link paths, so each key is resolved
 * as {@link createPathWithinMatcher} does.
 */
export function createLoadedFileMatcher(folderPath: string): PathMatcher {
  if (loaderPreservesSymlinks()) {
    return createPathWithinMatcher(folderPath);
  }
  const folderVariants = getPathVariants(folderPath);
  return (loadedFile) =>
    areVariantsWithin([path.resolve(loadedFile)], folderVariants);
}

export function isPathWithin(filePath: string, folderPath: string): boolean {
  return createPathWithinMatcher(folderPath)(filePath);
}

interface RawPackageJson {
  version?: unknown;
  antelopeJs?: unknown;
}

function readVersion(manifest: RawPackageJson): string | undefined {
  if (isString(manifest.version)) {
    return manifest.version;
  }
  return manifest.version ? JSON.stringify(manifest.version) : undefined;
}

function readAntelopeJs(manifest: RawPackageJson): PackageJson["antelopeJs"] {
  if (isObject(manifest.antelopeJs)) {
    return manifest.antelopeJs;
  }
  return manifest.antelopeJs ? {} : undefined;
}

/**
 * Reads the fields the resolver needs. A truthy `version` that is not a string
 * (npm installs a local package whose version is a number) stays resolvable as
 * the text it prints as, which is no valid semver and never satisfies a range.
 * A truthy `antelopeJs` that is not an object still marks an AntelopeJS package
 * with nothing declared. Falsy values read as absent.
 */
function parsePackageJson(text: string): PackageJson | undefined {
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed)) {
    return undefined;
  }
  return {
    name: isString(parsed.name) ? parsed.name : undefined,
    version: readVersion(parsed),
    antelopeJs: readAntelopeJs(parsed),
  };
}

function readPackageJson(packageRoot: string): PackageJson | undefined {
  try {
    return parsePackageJson(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    );
  } catch {
    return undefined;
  }
}

function createResolvedPackage(
  packageRoot: string,
  entry: string,
  resolveFrom: string,
  manifest: PackageJson,
): ResolvedPackage | undefined {
  if (!manifest.name || !manifest.version) {
    return undefined;
  }
  return {
    name: manifest.name,
    version: manifest.version,
    root: path.resolve(packageRoot),
    realRoot: normalizeExistingPath(packageRoot),
    entry: path.resolve(entry),
    resolveFrom: path.resolve(resolveFrom),
    antelopeJs: manifest.antelopeJs,
  };
}

export function findPackageFromEntry(
  entry: string,
  packageName: string,
  resolveFrom: string,
): ResolvedPackage | undefined {
  let currentFolder = statSync(entry).isDirectory()
    ? entry
    : path.dirname(entry);
  while (true) {
    const manifest = readPackageJson(currentFolder);
    if (manifest?.name === packageName) {
      return createResolvedPackage(currentFolder, entry, resolveFrom, manifest);
    }
    const parentFolder = path.dirname(currentFolder);
    if (parentFolder === currentFolder) {
      return undefined;
    }
    currentFolder = parentFolder;
  }
}

export function resolvePackage(
  packageName: string,
  fromFolder: string,
): ResolvedPackage | undefined {
  try {
    const entry = createRequire(
      path.join(path.resolve(fromFolder), "__antelope_resolver__.js"),
    ).resolve(packageName);
    return findPackageFromEntry(entry, packageName, fromFolder);
  } catch {
    return undefined;
  }
}

export function resolvePackageAtRoot(
  packageName: string,
  packageRoot: string,
  version: string | undefined,
): ResolvedPackage {
  const root = path.resolve(packageRoot);
  return {
    name: packageName,
    version,
    root,
    realRoot: normalizeExistingPath(root),
    entry: root,
    resolveFrom: root,
  };
}
