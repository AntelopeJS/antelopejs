import path from "node:path";

import type { IFileSystem } from "../../types";
import { isObject, isString } from "../../utils";

const PNPM_WORKSPACE_FILE = "pnpm-workspace.yaml";

const EXCLUDE_PREFIX = "!";

const MEMBER_MANIFEST = "package.json";

const IGNORED_FOLDERS = ["**/node_modules/**", "**/bower_components/**"];

/**
 * The glob patterns of the `packages` list of a `pnpm-workspace.yaml`, in any
 * YAML form pnpm accepts, aliases and merge keys resolved. An unparsable file
 * lists nothing.
 */
async function parseWorkspacePackages(yaml: string): Promise<string[]> {
  const { parseDocument } = await import("yaml");
  const document = parseDocument(yaml, { merge: true });
  if (document.errors.length > 0) {
    return [];
  }
  try {
    const manifest: unknown = document.toJS();
    const packages = isObject(manifest) ? manifest.packages : undefined;
    return Array.isArray(packages) ? packages.filter(isString) : [];
  } catch {
    return [];
  }
}

/** The glob pnpm searches for the `package.json` of each member `pattern` names. */
function memberManifestGlob(pattern: string): string {
  return pattern.replace(/\/?$/, `/${MEMBER_MANIFEST}`);
}

/**
 * Whether the `/`-separated `relativePath` is a member of a workspace listing
 * `patterns`, matched with the picomatch options pnpm's workspace search runs
 * tinyglobby with.
 */
async function isListed(
  relativePath: string,
  patterns: string[],
): Promise<boolean> {
  const { default: picomatch } = await import("picomatch");
  const included = patterns
    .filter((pattern) => !pattern.startsWith(EXCLUDE_PREFIX))
    .map(memberManifestGlob);
  const excluded = patterns
    .filter((pattern) => pattern.startsWith(EXCLUDE_PREFIX))
    .map((pattern) => memberManifestGlob(pattern.slice(EXCLUDE_PREFIX.length)));
  return picomatch(included, {
    ignore: [...excluded, ...IGNORED_FOLDERS],
    posix: true,
  })(`${relativePath}/${MEMBER_MANIFEST}`);
}

/**
 * The root of the pnpm workspace that installs `directory`: `directory`
 * itself when it holds a `pnpm-workspace.yaml`, or the nearest enclosing
 * workspace when its `packages` list names `directory`.
 *
 * @returns undefined when `directory` installs alone.
 */
export async function findPnpmWorkspaceRoot(
  directory: string,
  fileSystem: IFileSystem,
): Promise<string | undefined> {
  const member = path.isAbsolute(directory)
    ? directory
    : path.resolve(directory);
  for (let root = member; ; root = path.dirname(root)) {
    const manifest = path.join(root, PNPM_WORKSPACE_FILE);
    if (await fileSystem.exists(manifest)) {
      if (root === member) {
        return root;
      }
      const relativePath = path
        .relative(root, member)
        .split(path.sep)
        .join("/");
      const patterns = await parseWorkspacePackages(
        await fileSystem.readFileString(manifest),
      );
      return (await isListed(relativePath, patterns)) ? root : undefined;
    }
    if (path.dirname(root) === root) {
      return undefined;
    }
  }
}
