import { watch } from "node:fs";
import * as path from "node:path";

import type { IFileSystem } from "../../../types";
import { isVanishedPathError } from "./file-hasher";

/** How many times a failing ancestor watcher is re-created before giving up. */
export const WATCH_RETRY_LIMIT = 5;

/** The delay before a failing ancestor watcher is re-created. */
export const WATCH_RETRY_DELAY_MS = 1000;

/** The part of an `fs.watch` watcher that `MissingFolders` uses. */
export interface FolderWatcher {
  close(): void;
  on(event: "error", listener: (error: Error) => void): void;
}

/** Starts watching `dir`, calling `listener` on each event in it. */
export type WatchDirectory = (
  dir: string,
  listener: () => void,
) => FolderWatcher;

/**
 * Waits for missing folders to become directories again. Each missing folder
 * is watched through its nearest existing ancestor directory, and every event
 * there is reported through `onChange` so the owner calls `follow` again. An
 * ancestor watcher that fails is re-created after a delay, at most
 * `WATCH_RETRY_LIMIT` times until the folder is found.
 */
export class MissingFolders {
  private watchers = new Map<string, { dir: string; watcher: FolderWatcher }>();
  private failures = new Map<string, number>();
  private retries = new Map<string, NodeJS.Timeout>();
  private closed = false;

  constructor(
    private fs: IFileSystem,
    private onChange: (folder: string) => void,
    private watchDirectory: WatchDirectory = (dir, listener) =>
      watch(dir, listener),
  ) {}

  /**
   * Resolves `true` when `folder` is a directory, and stops waiting for it.
   * Otherwise moves its watcher to its nearest existing ancestor and resolves
   * `false`.
   */
  async follow(folder: string): Promise<boolean> {
    if (await this.isDirectory(folder)) {
      this.forget(folder);
      this.failures.delete(folder);
      return true;
    }
    const dir = await this.nearestExistingAncestor(folder);
    if (
      this.closed ||
      this.retries.has(folder) ||
      (this.failures.get(folder) ?? 0) > WATCH_RETRY_LIMIT ||
      this.watchers.get(folder)?.dir === dir
    ) {
      return false;
    }
    this.forget(folder);
    try {
      const watcher = this.watchDirectory(dir, () => this.onChange(folder));
      watcher.on("error", (err) => {
        if (this.watchers.get(folder)?.watcher === watcher) {
          this.forget(folder);
          this.retry(folder, dir, err);
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
    clearTimeout(this.retries.get(folder));
    this.retries.delete(folder);
  }

  /** Stops waiting for every folder, now and for later `follow` calls. */
  close(): void {
    this.closed = true;
    for (const folder of new Set([
      ...this.watchers.keys(),
      ...this.retries.keys(),
    ])) {
      this.forget(folder);
    }
  }

  private retry(folder: string, dir: string, err: Error): void {
    const failures = (this.failures.get(folder) ?? 0) + 1;
    this.failures.set(folder, failures);
    if (failures > WATCH_RETRY_LIMIT) {
      console.warn(
        `FileWatcher stopped watching ${dir} for ${folder} after ${WATCH_RETRY_LIMIT} failed restarts:`,
        err,
      );
      return;
    }
    console.error(`FileWatcher error for ${dir}:`, err);
    const timer = setTimeout(() => {
      this.retries.delete(folder);
      this.onChange(folder);
    }, WATCH_RETRY_DELAY_MS);
    this.retries.set(folder, timer);
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
    } catch {
      return false;
    }
  }
}
