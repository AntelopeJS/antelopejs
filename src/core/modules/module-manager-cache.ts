import * as path from "node:path";

import {
  clearPathResolutionCache,
  createPathWithinMatcher,
  type PathMatcher,
} from "../../utils";
import { INTERFACE_CORE_PACKAGE } from "./module-manager-bindings";
import {
  type InterfacePackagePlan,
  type ManagerContext,
} from "./module-manager-context";
import { resolveManifestEntryFile } from "./module-manifest";

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

  const moduleFolder = path.resolve(entry.module.manifest.folder);
  const moduleEntryFile = resolveManifestEntryFile(entry.module.manifest);
  const isInModule = createPathWithinMatcher(moduleFolder);
  const avoidedMatchers = this.collectAvoidedFolders(
    moduleId,
    moduleFolder,
    isInModule,
  ).map((folder) => createPathWithinMatcher(folder));

  for (const filePath of Object.keys(require.cache)) {
    if (!isInModule(filePath)) {
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

export function collectAvoidedFolders(
  this: ManagerContext,
  moduleId: string,
  moduleFolder: string,
  isInModule: PathMatcher,
): string[] {
  const avoidedFolders = new Set<string>([
    path.join(moduleFolder, "node_modules"),
  ]);
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
    .map((root) => createPathWithinMatcher(path.resolve(root)));
  for (const filePath of Object.keys(require.cache)) {
    if (matchers.some((isInCopy) => isInCopy(filePath))) {
      delete require.cache[filePath];
    }
  }
}
