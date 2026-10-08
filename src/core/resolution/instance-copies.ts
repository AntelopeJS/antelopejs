import path from "node:path";
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";

import { clearPathResolutionCache } from "./package-resolution";

/** Creates `destination` as a hard link to `source`; throws when the filesystem refuses. */
export type FileLinker = (source: string, destination: string) => void;

interface CopyContext {
  link: FileLinker;
  ancestors: Set<string>;
}

let nextGeneration = 1;

function realDirectory(folder: string): string | undefined {
  try {
    return realpathSync.native(folder);
  } catch {
    return undefined;
  }
}

function placeFile(source: string, destination: string, link: FileLinker) {
  try {
    link(source, destination);
  } catch {
    copyFileSync(source, destination);
  }
}

function copyDirectory(
  source: string,
  destination: string,
  context: CopyContext,
): void {
  const real = realDirectory(source);
  if (!real || context.ancestors.has(real)) {
    return;
  }
  context.ancestors.add(real);
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source)) {
    copyEntry(path.join(source, entry), path.join(destination, entry), context);
  }
  context.ancestors.delete(real);
}

type EntryKind = "directory" | "file" | "other";

function entryKind(source: string): EntryKind | undefined {
  try {
    const stats = statSync(source);
    if (stats.isDirectory()) {
      return "directory";
    }
    return stats.isFile() ? "file" : "other";
  } catch {
    return undefined;
  }
}

function copyEntry(
  source: string,
  destination: string,
  context: CopyContext,
): void {
  const kind = entryKind(source);
  if (kind === "directory") {
    copyDirectory(source, destination, context);
    return;
  }
  if (kind === "file") {
    placeFile(source, destination, context.link);
  }
}

/**
 * Builds an instance copy of a folder: a tree of hard links to its files, so
 * no file content is copied, with every symbolic link followed, so a package
 * linked from outside the folder (a pnpm or workspace layout) is part of the
 * copy instead of a link back to the shared original. A file the filesystem
 * refuses to link, across filesystems for instance, is copied instead.
 *
 * Node keys loaded modules by path, so every file of the copy is evaluated
 * apart from the original, dependencies included. Any previous content at
 * `destination` is removed first.
 */
export function createInstanceCopy(
  source: string,
  destination: string,
  link: FileLinker = linkSync,
): void {
  rmSync(destination, { recursive: true, force: true });
  copyDirectory(source, destination, { link, ancestors: new Set() });
  clearPathResolutionCache();
}

/** Deletes an instance copy once its files are no longer loaded. */
export function removeInstanceCopy(destination: string): void {
  rmSync(destination, { recursive: true, force: true });
  clearPathResolutionCache();
}

/**
 * A folder under `base` for a new generation of an instance copy. Paths are
 * never reused within a process, so Node's own path and realpath caches can
 * never serve a previous generation's files.
 */
export function nextInstanceCopyPath(base: string): string {
  const generation = nextGeneration;
  nextGeneration += 1;
  return path.join(base, `${process.pid}-${generation}`);
}
