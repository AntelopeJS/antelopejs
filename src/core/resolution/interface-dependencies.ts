import { readFileSync } from "node:fs";
import path from "node:path";

import { isObject } from "../../utils";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function readDependencyNames(packageRoot: string): string[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    );
  } catch {
    return [];
  }
  if (!isObject(manifest)) {
    return [];
  }
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const dependencies = manifest[field];
    return isObject(dependencies) ? Object.keys(dependencies) : [];
  });
}

/**
 * Interface packages an interface package imports, read from the
 * dependencies, peer dependencies and optional dependencies of its manifest
 * and kept only when they name one of `interfacePackages`.
 */
export function readInterfaceDependencies(
  packageName: string,
  packageRoot: string,
  interfacePackages: ReadonlySet<string>,
): string[] {
  const declared = readDependencyNames(packageRoot);
  return [...new Set(declared)].filter(
    (dependency) =>
      dependency !== packageName && interfacePackages.has(dependency),
  );
}
