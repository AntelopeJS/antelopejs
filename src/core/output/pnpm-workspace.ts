import path from "node:path";

import type { IFileSystem } from "../../types";

const PNPM_WORKSPACE_FILE = "pnpm-workspace.yaml";

const PACKAGES_KEY_PATTERN = /^packages:\s*(?:#.*)?$/;
const PACKAGE_ENTRY_PATTERN = /^\s+-\s*(['"]?)([^'"#\s]+)\1\s*(?:#.*)?$/;
const BLANK_LINE_PATTERN = /^\s*(?:#.*)?$/;
const EXCLUDE_PREFIX = "!";

/** The glob patterns of the `packages` list of a `pnpm-workspace.yaml`. */
function parseWorkspacePackages(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => PACKAGES_KEY_PATTERN.test(line));
  if (start === -1) {
    return [];
  }
  const patterns: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (BLANK_LINE_PATTERN.test(line)) {
      continue;
    }
    const entry = PACKAGE_ENTRY_PATTERN.exec(line);
    if (!entry) {
      break;
    }
    patterns.push(entry[2]);
  }
  return patterns;
}

/** Whether the `/`-separated `relativePath` matches the pnpm glob `pattern`. */
function matchesGlob(relativePath: string, pattern: string): boolean {
  const source = pattern
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .split("/")
    .map((segment) =>
      segment === "**"
        ? "(?:[^/]+/)*"
        : `${segment
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, "[^/]*")
            .replace(/\?/g, "[^/]")}/`,
    )
    .join("");
  return new RegExp(`^${source}$`).test(`${relativePath}/`);
}

function isListed(relativePath: string, patterns: string[]): boolean {
  const excluded = patterns
    .filter((pattern) => pattern.startsWith(EXCLUDE_PREFIX))
    .some((pattern) =>
      matchesGlob(relativePath, pattern.slice(EXCLUDE_PREFIX.length)),
    );
  return (
    !excluded &&
    patterns
      .filter((pattern) => !pattern.startsWith(EXCLUDE_PREFIX))
      .some((pattern) => matchesGlob(relativePath, pattern))
  );
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
      const patterns = parseWorkspacePackages(
        await fileSystem.readFileString(manifest),
      );
      return isListed(relativePath, patterns) ? root : undefined;
    }
    if (path.dirname(root) === root) {
      return undefined;
    }
  }
}
