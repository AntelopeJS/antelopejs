import { type Dirent, readdirSync } from "node:fs";
import * as path from "node:path";

import {
  clearPathResolutionCache,
  createLoadedFileMatcher,
  createPathWithinMatcher,
  normalizeExistingPath,
  type PathMatcher,
} from "../../utils";
import { INTERFACE_CORE_PACKAGE } from "./module-manager-bindings";
import {
  type InterfacePackagePlan,
  type ManagerContext,
} from "./module-manager-context";
import { resolveManifestEntryFile } from "./module-manifest";

const NODE_MODULES = "node_modules";

export function unrequireModuleFiles(
  this: ManagerContext,
  moduleId: string,
  shouldPreserveInterfaceGraph = true,
): void {
  clearPathResolutionCache();
  this.evictModuleFiles(moduleId, shouldPreserveInterfaceGraph);
}

export function evictModuleFiles(
  this: ManagerContext,
  moduleId: string,
  shouldPreserveInterfaceGraph: boolean,
): void {
  const entry = this.loaded.get(moduleId);
  if (!entry) {
    return;
  }

  const moduleRoots = collectModuleRoots(
    path.resolve(entry.module.manifest.folder),
  );
  const moduleEntryFile = resolveManifestEntryFile(entry.module.manifest);
  const isInModule = matchAny(moduleRoots.map(createPathWithinMatcher));
  const isLoadedInModule = matchAny(moduleRoots.map(createLoadedFileMatcher));
  const avoidedMatchers = this.collectAvoidedFolders(
    moduleId,
    moduleRoots,
    isInModule,
  ).map((folder) => createLoadedFileMatcher(folder));

  for (const filePath of Object.keys(require.cache)) {
    if (!isLoadedInModule(filePath)) {
      continue;
    }
    if (
      shouldPreserveInterfaceGraph &&
      filePath !== moduleEntryFile &&
      this.belongsToInterfacePackageTree(filePath, isInModule)
    ) {
      continue;
    }
    if (!avoidedMatchers.some((isAvoided) => isAvoided(filePath))) {
      delete require.cache[filePath];
    }
  }
}

function matchAny(matchers: readonly PathMatcher[]): PathMatcher {
  return (filePath) => matchers.some((matches) => matches(filePath));
}

/**
 * The folder of a module and the real target of each symbolic link inside it,
 * outside its `node_modules`. The module loader names a file by its real
 * path, so a module whose code folder links to a checkout elsewhere has its
 * files cached under that checkout's paths, not under its own folder.
 */
function collectModuleRoots(moduleFolder: string): string[] {
  const roots = [moduleFolder];
  const pending = [moduleFolder];
  const visited = new Set<string>();
  for (let folder = pending.pop(); folder; folder = pending.pop()) {
    const realFolder = normalizeExistingPath(folder);
    if (visited.has(realFolder)) {
      continue;
    }
    visited.add(realFolder);
    for (const child of readFolder(folder)) {
      if (child.name === NODE_MODULES) {
        continue;
      }
      const childPath = path.join(folder, child.name);
      if (child.isDirectory()) {
        pending.push(childPath);
      } else if (child.isSymbolicLink()) {
        const target = normalizeExistingPath(childPath);
        roots.push(target);
        pending.push(target);
      }
    }
  }
  return roots;
}

function readFolder(folder: string): Dirent[] {
  try {
    return readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function collectAvoidedFolders(
  this: ManagerContext,
  moduleId: string,
  moduleRoots: readonly string[],
  isInModule: PathMatcher,
): string[] {
  const avoidedFolders = new Set<string>(
    moduleRoots.map((root) => path.join(root, NODE_MODULES)),
  );
  for (const [id, other] of this.loaded) {
    if (id !== moduleId && isInModule(other.module.manifest.folder)) {
      avoidedFolders.add(path.resolve(other.module.manifest.folder));
    }
  }
  return [...avoidedFolders];
}

export function belongsToInterfacePackageTree(
  this: ManagerContext,
  filePath: string,
  isInModule: PathMatcher,
): boolean {
  const root = this.resolver.getInterfaceGraphRoot(filePath);
  if (!root) {
    return false;
  }
  return isInModule(path.resolve(root));
}

/**
 * Drops every copy of the planned interface packages from the require cache,
 * the canonical one and each consumer's, so the next generation can choose its
 * canonical copy afresh. `@antelopejs/interface-core` stays: the core itself
 * implements it.
 */
export function evictInterfacePackageCopies(
  plans: ReadonlyMap<string, InterfacePackagePlan>,
): void {
  const matchers = [...plans]
    .filter(([packageName]) => packageName !== INTERFACE_CORE_PACKAGE)
    .flatMap(([, plan]) => [
      plan.canonicalPackage,
      ...plan.consumers.flatMap(({ resolvedPackage }) =>
        resolvedPackage ? [resolvedPackage] : [],
      ),
    ])
    .flatMap(({ root, realRoot }) => [root, realRoot])
    .map((root) => createLoadedFileMatcher(path.resolve(root)));
  for (const filePath of Object.keys(require.cache)) {
    if (matchers.some((isInCopy) => isInCopy(filePath))) {
      delete require.cache[filePath];
    }
  }
}
