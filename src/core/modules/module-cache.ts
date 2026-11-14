import { Logging } from "@antelopejs/interface-core/logging";
import { randomUUID } from "node:crypto";
import * as fsNode from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { satisfies } from "semver";

import type { IFileSystem } from "../../types";
import { NodeFileSystem } from "../filesystem";
import { isPlainObject, isString } from "../../utils";
import {
  hasErrorCode,
  readFolderNames,
  readLiveLeaseEntries,
  RunLeaseFile,
} from "./cache-leases";
import { acquirePruneLock, waitWhilePruneLocked } from "./cache-prune-lock";

const Logger = new Logging.Channel("loader");

const TRASH_FOLDER = ".trash";

/** Whether a prune keeps a manifest entry that no live run's lease covers. */
export type CacheKeep = (entry: string) => boolean;

/**
 * Whether `entry`, a path relative to the cache with `/` separators, lies in
 * the folder of the manifest entry `key`.
 */
export function entryCovers(entry: string, key: string): boolean {
  return entry === key || entry.startsWith(`${key}/`);
}

function isVersionManifest(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every(isString);
}

export class ModuleCache {
  private manifest: Record<string, string> = {};
  private pendingSave: Promise<void> = Promise.resolve();
  private readonly claims = new Map<string, Promise<void>>();
  private readonly lease: RunLeaseFile;

  constructor(
    public readonly path: string,
    private fs: IFileSystem = new NodeFileSystem(),
  ) {
    this.lease = new RunLeaseFile(path, fs);
  }

  async load(): Promise<void> {
    await this.fs.mkdir(this.path, { recursive: true });
    const manifestPath = path.join(this.path, "manifest.json");
    this.manifest = {};
    if (await this.fs.exists(manifestPath)) {
      try {
        const data = await this.fs.readFileString(manifestPath);
        const parsed: unknown = JSON.parse(data);
        this.manifest = isVersionManifest(parsed) ? parsed : {};
      } catch {
        this.manifest = {};
      }
    }
  }

  save(): Promise<void> {
    const manifestPath = path.join(this.path, "manifest.json");
    this.pendingSave = this.pendingSave.then(() =>
      this.fs.writeFile(manifestPath, JSON.stringify(this.manifest, null, 2)),
    );
    return this.pendingSave;
  }

  getVersion(module: string): string | undefined {
    return Object.hasOwn(this.manifest, module)
      ? this.manifest[module]
      : undefined;
  }

  /** Every cache entry with the version it holds. */
  entries(): [string, string][] {
    return Object.entries(this.manifest);
  }

  setVersion(module: string, version: string): void {
    this.manifest[module] = version;
  }

  hasVersion(module: string, version: string): boolean {
    const cached = this.getVersion(module);
    return !!cached && satisfies(cached, version);
  }

  /**
   * The cache entry that holds `folder`, as a path relative to the cache with
   * `/` separators, or `undefined` for a folder outside the cache.
   */
  entryOf(folder: string): string | undefined {
    const relative = path.relative(this.path, path.resolve(folder));
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return undefined;
    }
    return relative.split(path.sep).join("/");
  }

  /**
   * Records the cache entry that holds `folder` in this run's lease, so that
   * no prune removes it while this process runs. Resolves once the lease
   * names it and no live prune holds the cache, so a folder checked on disk
   * afterwards stays. A folder outside the cache is not recorded.
   */
  claimFolder(folder: string): Promise<void> {
    const entry = this.entryOf(folder);
    return entry === undefined ? Promise.resolve() : this.claim(entry);
  }

  private claim(entry: string): Promise<void> {
    const pending = this.claims.get(entry);
    if (pending !== undefined) {
      return pending;
    }
    const claimed = this.lease
      .add(entry)
      .then(() => waitWhilePruneLocked(this.path, this.fs));
    this.claims.set(entry, claimed);
    return claimed;
  }

  async getFolder(
    module: string,
    noClean?: boolean,
    noCreate?: boolean,
  ): Promise<string> {
    const folder = path.join(this.path, module);
    await this.claimFolder(folder);
    if (!noClean) {
      await this.fs.rm(folder, { recursive: true, force: true });
    }
    if (!noCreate) {
      await this.fs.mkdir(folder, { recursive: true });
    }
    return folder;
  }

  static getTemp(): Promise<string> {
    return fsNode.mkdtemp(path.join(os.tmpdir(), "ajs-"));
  }

  async transfer(source: string, module: string): Promise<string> {
    const dest = await this.getFolder(module, false, false);
    await this.copyDir(source, dest);
    await this.fs.rm(source, { recursive: true, force: true });
    return dest;
  }

  async commitVersion(module: string, version: string): Promise<void> {
    this.setVersion(module, version);
    await this.save();
  }

  async clearVersion(module: string): Promise<void> {
    delete this.manifest[module];
    await this.save();
  }

  /**
   * Removes every manifest entry, and its folder, that no lease of a live run
   * covers and that the rule `readKeep` resolves to does not keep. It runs
   * under the prune lock of the cache and skips when another live prune holds
   * it. The manifest, the leases and then the keep rule are read in that
   * order under the lock: a run leases an entry before it adds the entry to
   * the manifest, and a build pins its `build.json` before its process drops
   * its lease, so an entry in use shows in one of them. A run that claims an
   * entry while a prune holds the lock waits for it, then finds a removed
   * folder gone. The folders are moved to `.trash` under the lock and deleted
   * once it is released.
   *
   * @throws when a lease cannot be parsed, with nothing removed.
   */
  async prune(readKeep: () => Promise<CacheKeep>): Promise<void> {
    await this.pendingSave;
    await this.emptyTrash();
    const lock = await acquirePruneLock(this.path, this.fs);
    if (lock === undefined) {
      Logger.Debug(`Another process prunes ${this.path}; skipping`);
      return;
    }
    let trashed: string[];
    try {
      trashed = await this.moveUnusedToTrash(readKeep);
    } finally {
      await lock.release();
    }
    await this.removeAll(trashed);
  }

  private async moveUnusedToTrash(
    readKeep: () => Promise<CacheKeep>,
  ): Promise<string[]> {
    await this.load();
    const leased = await readLiveLeaseEntries(this.path, this.fs);
    const keep = await readKeep();
    const unused = this.entries()
      .map(([key]) => key)
      .filter(
        (key) => !keep(key) && !leased.some((entry) => entryCovers(entry, key)),
      );
    if (unused.length === 0) {
      return [];
    }
    const trash = path.join(this.path, TRASH_FOLDER);
    await this.fs.mkdir(trash, { recursive: true });
    const trashed: string[] = [];
    for (const key of unused) {
      const target = path.join(trash, randomUUID());
      if (await this.moveIfPresent(path.join(this.path, key), target)) {
        trashed.push(target);
      }
    }
    await this.load();
    for (const key of unused) {
      delete this.manifest[key];
    }
    await this.save();
    return trashed;
  }

  private async moveIfPresent(
    source: string,
    target: string,
  ): Promise<boolean> {
    try {
      await this.fs.rename(source, target);
      return true;
    } catch (error) {
      if (error instanceof Error && hasErrorCode(error, "ENOENT")) {
        return false;
      }
      throw error;
    }
  }

  private async emptyTrash(): Promise<void> {
    const trash = path.join(this.path, TRASH_FOLDER);
    const names = await readFolderNames(trash, this.fs);
    await this.removeAll(names.map((name) => path.join(trash, name)));
  }

  private async removeAll(folders: string[]): Promise<void> {
    await Promise.all(
      folders.map((folder) =>
        this.fs.rm(folder, { recursive: true, force: true }),
      ),
    );
  }

  private async copyDir(source: string, dest: string): Promise<void> {
    await this.fs.mkdir(dest, { recursive: true });
    const entries = await this.fs.readdir(source);
    for (const entry of entries) {
      const srcPath = path.join(source, entry);
      const destPath = path.join(dest, entry);
      const stat = await this.fs.stat(srcPath);
      if (stat.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        await this.fs.copyFile(srcPath, destPath);
      }
    }
  }
}
