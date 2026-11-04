import fs from "node:fs";
import path from "node:path";

import { isObject } from "../../src/utils";

const FILE_SPEC = "file:";

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
