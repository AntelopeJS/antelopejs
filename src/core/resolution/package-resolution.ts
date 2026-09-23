import path from "node:path";
import { createRequire } from "node:module";
import { readFileSync, realpathSync, statSync } from "node:fs";

export interface ResolvedPackage {
  name: string;
  version: string;
  root: string;
  realRoot: string;
  entry: string;
  resolveFrom: string;
  antelopeJs?: Record<string, unknown>;
}

export type PathMatcher = (filePath: string) => boolean;

interface PackageJson {
  name?: string;
  version?: string;
  antelopeJs?: Record<string, unknown>;
}

const realPathCache = new Map<string, string>();
let pathCacheGeneration = 0;

/**
 * Forgets every cached `realpath` lookup.
 *
 * Call it whenever the file layout may have changed on disk (a module was
 * installed, reinstalled or reloaded), so symlinks are resolved again.
 */
export function clearPathResolutionCache(): void {
  realPathCache.clear();
  pathCacheGeneration += 1;
}

/**
 * Increases each time the `realpath` cache is cleared, so derived caches can
 * tell they are stale.
 */
export function getPathResolutionCacheGeneration(): number {
  return pathCacheGeneration;
}

function normalizeExistingPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  const cachedPath = realPathCache.get(resolvedPath);
  if (cachedPath !== undefined) {
    return cachedPath;
  }
  try {
    const realPath = realpathSync.native(resolvedPath);
    realPathCache.set(resolvedPath, realPath);
    return realPath;
  } catch {
    return resolvedPath;
  }
}

export function getPathVariants(filePath: string): string[] {
  const logicalPath = path.resolve(filePath);
  const realPath = normalizeExistingPath(logicalPath);
  return logicalPath === realPath ? [logicalPath] : [logicalPath, realPath];
}

function isVariantWithin(fileVariant: string, folderVariant: string): boolean {
  const relativePath = path.relative(folderVariant, fileVariant);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

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

export function isPathWithin(filePath: string, folderPath: string): boolean {
  return createPathWithinMatcher(folderPath)(filePath);
}

function readPackageJson(packageRoot: string): PackageJson | undefined {
  try {
    return JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as PackageJson;
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
  version: string,
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
