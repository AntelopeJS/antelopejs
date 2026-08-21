import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface ResolvedPackage {
  name: string;
  version: string;
  root: string;
  realRoot: string;
  entry: string;
  resolveFrom: string;
  antelopeJs?: Record<string, unknown>;
}

interface PackageJson {
  name?: string;
  version?: string;
  antelopeJs?: Record<string, unknown>;
}

function normalizeExistingPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  try {
    return realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

export function getPathVariants(filePath: string): string[] {
  const logicalPath = path.resolve(filePath);
  const realPath = normalizeExistingPath(logicalPath);
  return logicalPath === realPath ? [logicalPath] : [logicalPath, realPath];
}

export function isPathWithin(filePath: string, folderPath: string): boolean {
  return getPathVariants(filePath).some((fileVariant) =>
    getPathVariants(folderPath).some((folderVariant) => {
      const relativePath = path.relative(folderVariant, fileVariant);
      return (
        relativePath === "" ||
        (!relativePath.startsWith(`..${path.sep}`) &&
          relativePath !== ".." &&
          !path.isAbsolute(relativePath))
      );
    }),
  );
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

export function resolvePackageSubpath(
  packageName: string,
  subpath: string,
  resolvedPackage: ResolvedPackage,
): string | undefined {
  try {
    const entry = createRequire(
      path.join(resolvedPackage.root, "__antelope_resolver__.js"),
    ).resolve(`${packageName}/${subpath}`);
    return isPathWithin(entry, resolvedPackage.root) ? entry : undefined;
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
