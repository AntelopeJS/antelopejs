import path from "node:path";
import { readFileSync } from "node:fs";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

type DependencyField = (typeof DEPENDENCY_FIELDS)[number];
type DependencyManifest = Partial<
  Record<DependencyField, Record<string, string>>
>;

function readManifest(packageRoot: string): DependencyManifest {
  try {
    return JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as DependencyManifest;
  } catch {
    return {};
  }
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
  const manifest = readManifest(packageRoot);
  const declared = DEPENDENCY_FIELDS.flatMap((field) =>
    Object.keys(manifest[field] ?? {}),
  );
  return [...new Set(declared)].filter(
    (dependency) =>
      dependency !== packageName && interfacePackages.has(dependency),
  );
}
