import fs from "node:fs";
import path from "node:path";

import { isObject } from "../../src/utils";

const FILE_SPEC = "file:";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFileSpec(spec: unknown): spec is `file:${string}` {
  return typeof spec === "string" && spec.startsWith(FILE_SPEC);
}

/**
 * The interface-core tarball a repository's `pnpm.overrides` pins, as an
 * absolute path; undefined when interface-core comes from the registry.
 *
 * @param root Folder of the repository's package.json
 */
export function overriddenInterfaceCore(root: string): string | undefined {
  const manifest: unknown = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const pnpmField = isObject(manifest) ? manifest.pnpm : undefined;
  const overrides = isObject(pnpmField) ? pnpmField.overrides : undefined;
  const spec = isObject(overrides)
    ? overrides["@antelopejs/interface-core"]
    : undefined;
  return isFileSpec(spec)
    ? path.resolve(root, spec.slice(FILE_SPEC.length))
    : undefined;
}

/**
 * The interface-core range a package.json declares in `dependencies`, or
 * undefined when it declares none.
 *
 * @param content The package.json text
 */
export function declaredInterfaceCoreRange(
  content: string,
): string | undefined {
  const manifest: unknown = JSON.parse(content);
  const dependencies = isObject(manifest) ? manifest.dependencies : undefined;
  const range = isObject(dependencies)
    ? dependencies["@antelopejs/interface-core"]
    : undefined;
  return isString(range) ? range : undefined;
}

/**
 * The interface-core range the repository at `root` declares.
 *
 * @param root Folder of the repository's package.json
 */
export function repositoryInterfaceCoreRange(root: string): string {
  const range = declaredInterfaceCoreRange(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  if (range === undefined) {
    throw new Error(`${root}/package.json declares no interface-core range.`);
  }
  return range;
}
