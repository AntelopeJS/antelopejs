import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

import { clearPathResolutionCache } from "../../utils";

/** Creates `destination` as a hard link to `source`; throws when the filesystem refuses. */
type FileLinker = (source: string, destination: string) => void;

/**
 * Creates `destination` as a symbolic link to `target`, given relative to the
 * folder of `destination`; throws when the filesystem refuses. `type` is the
 * link Windows needs: a junction for a directory, which takes no privilege,
 * and a file link otherwise. Other platforms ignore it.
 */
type SymbolicLinker = (
  target: string,
  destination: string,
  type: "junction" | "file",
) => void;

/** How an instance copy places files and links; both default to the filesystem. */
interface InstanceCopyLinkers {
  link?: FileLinker;
  symlink?: SymbolicLinker;
}

/** What an instance copy could not keep inside itself. */
interface InstanceCopyReport {
  /**
   * Symbolic links, relative to the copied folder, whose target lies outside
   * that folder and is copied in their place.
   */
  followedLinks: string[];
}

interface CopyContext {
  link: FileLinker;
  symlink: SymbolicLinker;
  ancestors: Set<string>;
  sourceRoot: string;
  destinationRoot: string;
  followedLinks: string[];
}

let nextGeneration = 1;
const GENERATION_PATTERN = /^(\d+)-\d+$/;

function realDirectory(folder: string): string | undefined {
  try {
    return realpathSync.native(folder);
  } catch {
    return undefined;
  }
}

function linkTarget(source: string): string | undefined {
  try {
    return lstatSync(source).isSymbolicLink()
      ? realpathSync.native(source)
      : undefined;
  } catch {
    return undefined;
  }
}

function isWithin(folder: string, target: string): boolean {
  const relative = path.relative(folder, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function keepLink(
  target: string,
  destination: string,
  context: CopyContext,
): boolean {
  const copiedTarget = path.join(
    context.destinationRoot,
    path.relative(context.sourceRoot, target),
  );
  try {
    context.symlink(
      path.relative(path.dirname(destination), copiedTarget),
      destination,
      statSync(target).isDirectory() ? "junction" : "file",
    );
    return true;
  } catch {
    return false;
  }
}

function placeLink(
  source: string,
  destination: string,
  context: CopyContext,
): boolean {
  const target = linkTarget(source);
  if (!target) {
    return false;
  }
  if (isWithin(context.sourceRoot, target)) {
    return keepLink(target, destination, context);
  }
  context.followedLinks.push(
    path.relative(context.destinationRoot, destination),
  );
  return false;
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
  if (placeLink(source, destination, context)) {
    return;
  }
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
 * no file content is copied. A file the filesystem refuses to link, across
 * filesystems for instance, is copied instead.
 *
 * A symbolic link whose target lies inside the folder, as in a pnpm layout,
 * is recreated as a link to the same place in the copy, so a package keeps
 * resolving the packages installed beside it. A link whose target lies
 * outside the folder, as in a workspace, is followed: its target becomes part
 * of the copy instead of a link back to the shared original, and the report
 * lists it, since what is installed beside that target is not copied.
 *
 * Node keys loaded modules by their real path, so every file of the copy is
 * evaluated apart from the original, dependencies included. Any previous
 * content at `destination` is removed first.
 */
export function createInstanceCopy(
  source: string,
  destination: string,
  { link = linkSync, symlink = symlinkSync }: InstanceCopyLinkers = {},
): InstanceCopyReport {
  rmSync(destination, { recursive: true, force: true });
  const followedLinks: string[] = [];
  copyDirectory(source, destination, {
    link,
    symlink,
    ancestors: new Set(),
    sourceRoot: realDirectory(source) ?? path.resolve(source),
    destinationRoot: destination,
    followedLinks,
  });
  clearPathResolutionCache();
  return { followedLinks };
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

function isRunning(pid: number): boolean {
  if (pid === process.pid) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // SAFETY: Node process.kill reports system-call failures with Error objects carrying an errno code; this catch contains only that native call.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function pruneGenerations(base: string): void {
  for (const entry of readdirSync(base)) {
    const owner = GENERATION_PATTERN.exec(entry)?.[1];
    if (owner && !isRunning(Number(owner))) {
      rmSync(path.join(base, entry), { recursive: true, force: true });
    }
  }
}

/**
 * Deletes the instance copies under `root` left by processes that are no
 * longer running, such as a build that never tears its modules down.
 */
export function pruneStaleInstanceCopies(root: string): void {
  if (!existsSync(root)) {
    return;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      pruneGenerations(path.join(root, entry.name));
    }
  }
}
