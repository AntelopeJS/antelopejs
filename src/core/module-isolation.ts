import os from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";

import type { ModuleManifest } from "./module-manifest";
import { createPathWithinMatcher } from "./resolution/package-resolution";
import {
  createInstanceCopy,
  nextInstanceCopyPath,
  pruneStaleInstanceCopies,
  removeInstanceCopy,
} from "./resolution/instance-copies";

const DEFAULT_INSTANCE_ROOT = path.join(os.tmpdir(), "antelopejs-instances");

/** Folder, inside a module cache, that holds instance copies of module packages. */
export const INSTANCES_FOLDER = ".instances";

function realFolder(folder: string): string {
  try {
    return realpathSync.native(folder);
  } catch {
    return path.resolve(folder);
  }
}

function evictFolder(folder: string): void {
  const isInFolder = createPathWithinMatcher(folder);
  for (const filePath of Object.keys(require.cache)) {
    if (isInFolder(filePath)) {
      delete require.cache[filePath];
    }
  }
}

/**
 * Gives every module instance its own evaluated copy of its package.
 *
 * The first module loaded from a folder uses it in place. Each further module
 * loaded from the same folder (two instances of one package, configured
 * apart) is loaded from an instance copy of that folder, dependencies
 * included, so no module-level state is shared between them.
 */
export class ModuleIsolation {
  private readonly origins = new Map<string, string>();
  private readonly copies = new Map<string, string>();
  private readonly pendingOrigins = new Map<string, string>();
  private readonly prunedRoots = new Set<string>();

  constructor(private root = DEFAULT_INSTANCE_ROOT) {}

  /** Sets the folder instance copies are created under. */
  setRoot(root: string): void {
    this.root = root;
  }

  /**
   * The manifest `moduleId` should be loaded from: `manifest` itself, or a
   * relocated copy when another module already loads its folder.
   */
  place(moduleId: string, manifest: ModuleManifest): ModuleManifest {
    const origin = realFolder(manifest.folder);
    const isTaken = [...this.origins].some(
      ([id, taken]) => id !== moduleId && taken === origin,
    );
    if (!isTaken) {
      return manifest;
    }
    const copy = this.createCopy(moduleId, manifest.folder);
    this.pendingOrigins.set(copy, origin);
    return manifest.relocate(copy);
  }

  /** Records that `moduleId` now runs from `manifest`, releasing its previous copy. */
  adopt(moduleId: string, manifest: ModuleManifest): void {
    const folder = manifest.folder;
    const origin = this.pendingOrigins.get(folder) ?? realFolder(folder);
    this.pendingOrigins.delete(folder);
    const previous = this.copies.get(moduleId);
    if (previous && previous !== folder) {
      this.removeCopy(previous);
    }
    this.origins.set(moduleId, origin);
    if (origin === realFolder(folder)) {
      this.copies.delete(moduleId);
      return;
    }
    this.copies.set(moduleId, folder);
  }

  /** Deletes the copy behind a placed manifest that never ran. */
  discard(manifest: ModuleManifest): void {
    if (this.pendingOrigins.delete(manifest.folder)) {
      this.removeCopy(manifest.folder);
    }
  }

  /** Forgets every module and deletes every copy, once their files are no longer used. */
  releaseAll(): void {
    for (const copy of this.copies.values()) {
      this.removeCopy(copy);
    }
    for (const copy of this.pendingOrigins.keys()) {
      this.removeCopy(copy);
    }
    this.copies.clear();
    this.pendingOrigins.clear();
    this.origins.clear();
  }

  private createCopy(moduleId: string, folder: string): string {
    if (!this.prunedRoots.has(this.root)) {
      pruneStaleInstanceCopies(this.root);
      this.prunedRoots.add(this.root);
    }
    const base = path.join(this.root, encodeURIComponent(moduleId));
    const copy = nextInstanceCopyPath(base);
    createInstanceCopy(folder, copy);
    return copy;
  }

  private removeCopy(copy: string): void {
    evictFolder(copy);
    removeInstanceCopy(copy);
  }
}
