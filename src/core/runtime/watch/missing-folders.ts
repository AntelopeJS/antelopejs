import { type FSWatcher, watch } from "node:fs";
import * as path from "node:path";

import type { IFileSystem } from "../../../types";
import { isVanishedPathError } from "./file-hasher";

/**
 * Waits for missing folders to become directories again. Each missing folder
 * is watched through its nearest existing ancestor directory, and every event
 * there is reported through `onChange` so the owner calls `follow` again.
 */
export class MissingFolders {
  private watchers = new Map<string, { dir: string; watcher: FSWatcher }>();
  private closed = false;

  constructor(
    private fs: IFileSystem,
    private onChange: (folder: string) => void,
  ) {}

  /**
   * Resolves `true` when `folder` is a directory, and stops waiting for it.
   * Otherwise moves its watcher to its nearest existing ancestor and resolves
   * `false`.
   */
  async follow(folder: string): Promise<boolean> {
    if (await this.isDirectory(folder)) {
      this.forget(folder);
      return true;
    }
    const dir = await this.nearestExistingAncestor(folder);
    if (this.closed || this.watchers.get(folder)?.dir === dir) {
      return false;
    }
    this.forget(folder);
    try {
      const watcher = watch(dir, () => this.onChange(folder));
      watcher.on("error", (err) => {
        console.error(`FileWatcher error for ${dir}:`, err);
        if (this.watchers.get(folder)?.watcher === watcher) {
          this.forget(folder);
          this.onChange(folder);
        }
      });
      this.watchers.set(folder, { dir, watcher });
    } catch (err) {
      if (!(err instanceof Error && isVanishedPathError(err))) {
        console.error(`Failed to watch directory ${dir}:`, err);
        return false;
      }
    }
    this.onChange(folder);
    return false;
  }

  /** Stops waiting for `folder`. */
  forget(folder: string): void {
    this.watchers.get(folder)?.watcher.close();
    this.watchers.delete(folder);
  }

  /** Stops waiting for every folder, now and for later `follow` calls. */
  close(): void {
    this.closed = true;
    for (const folder of this.watchers.keys()) {
      this.forget(folder);
    }
  }

  private async nearestExistingAncestor(dirPath: string): Promise<string> {
    const parent = path.dirname(dirPath);
    return parent === dirPath || (await this.isDirectory(parent))
      ? parent
      : this.nearestExistingAncestor(parent);
  }

  private async isDirectory(dirPath: string): Promise<boolean> {
    try {
      return (await this.fs.stat(dirPath)).isDirectory();
    } catch (error) {
      if (error instanceof Error && isVanishedPathError(error)) {
        return false;
      }
      throw error;
    }
  }
}
