import { Logging } from "@antelopejs/interface-core/logging";
import { randomUUID } from "node:crypto";
import * as fsNode from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { satisfies } from "semver";

import type { IFileSystem } from "../../types";
import { NodeFileSystem } from "../filesystem";
import {
  hasErrorCode,
  isForeignProcess,
  readFolderNames,
  readLiveLeases,
  readOtherLiveLeases,
  RunLeaseFile,
} from "./cache-leases";
import {
  type CacheLock,
  PRUNE_LOCK,
  tryAcquireCacheLock,
  waitWhileCacheLocked,
} from "./cache-lock";
import { CacheManifest } from "./cache-manifest";

const Logger = new Logging.Channel("loader");

const TRASH_FOLDER = ".trash";

/** Whether a prune keeps a manifest entry that no live run's lease covers. */
export type CacheKeep = (entry: string) => boolean;

/**
 * What a prune did with the folder of an unused entry: moved it to the trash,
 * found it already gone, or kept it because it could not be moved.
 */
type TrashOutcome = "moved" | "absent" | "kept";

/**
 * Whether `entry`, a path relative to the cache with `/` separators, lies in
 * the folder of the manifest entry `key`.
 */
export function entryCovers(entry: string, key: string): boolean {
  return entry === key || entry.startsWith(`${key}/`);
}

/**
 * The entry of the cache at `cachePath` that holds `folder`, as a path
 * relative to the cache with `/` separators, or `undefined` for a folder
 * outside the cache.
 */
function cacheEntryOf(cachePath: string, folder: string): string | undefined {
  const relative = path.relative(cachePath, path.resolve(folder));
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
 * Whether the manifest key `key` names a folder of the cache at `cachePath`
 * that a prune may remove: spelled as {@link cacheEntryOf} spells its folder,
 * so inside the cache, and outside the dot folders such as `.leases`.
 */
function isPrunableKey(cachePath: string, key: string): boolean {
  return (
    !key.startsWith(".") &&
    cacheEntryOf(cachePath, path.join(cachePath, key)) === key
  );
}

async function realPathOrResolved(target: string): Promise<string> {
  try {
    return await fsNode.realpath(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * The entry of the cache at `cachePath` that holds `folder`, as
 * {@link cacheEntryOf} finds it, comparing real paths when the two are
 * spelled through different symbolic links.
 */
export async function findCacheEntry(
  cachePath: string,
  folder: string,
): Promise<string | undefined> {
  return (
    cacheEntryOf(cachePath, folder) ??
    cacheEntryOf(
      await realPathOrResolved(cachePath),
      await realPathOrResolved(folder),
    )
  );
}

export class ModuleCache {
  private readonly manifest: CacheManifest;
  private readonly claims = new Map<string, Promise<void>>();
  private readonly lease: RunLeaseFile;

  constructor(
    public readonly path: string,
    private fs: IFileSystem = new NodeFileSystem(),
  ) {
    this.lease = new RunLeaseFile(path, fs);
    this.manifest = new CacheManifest(path, fs);
  }

  /**
   * Creates the cache folder and reads `manifest.json` again, keeping the
   * versions this run set or cleared and has not saved yet.
   */
  async load(): Promise<void> {
    await this.fs.mkdir(this.path, { recursive: true });
    await this.manifest.load();
  }

  /**
   * Writes the manifest after the saves before it, under the manifest lock
   * of the cache. It re-reads `manifest.json` and applies only the versions
   * this run set or cleared, so that the entries another run committed
   * meanwhile stay, and renames a temporary file over it, so that another
   * run never reads it halfway.
   */
  save(): Promise<void> {
    return this.manifest.save();
  }

  getVersion(module: string): string | undefined {
    return this.manifest.get(module);
  }

  /** Every cache entry with the version it holds. */
  entries(): [string, string][] {
    return this.manifest.list();
  }

  setVersion(module: string, version: string): void {
    this.manifest.set(module, version);
  }

  hasVersion(module: string, version: string): boolean {
    const cached = this.getVersion(module);
    return !!cached && satisfies(cached, version);
  }

  /**
   * Records the cache entry that holds `folder` in this run's lease, so that
   * no prune removes it while this process runs. Resolves once the lease
   * names it and no live prune holds the cache, so a folder checked on disk
   * afterwards stays. A folder outside the cache is not recorded.
   */
  async claimFolder(folder: string): Promise<void> {
    const entry = await findCacheEntry(this.path, folder);
    if (entry !== undefined) {
      await this.claim(entry);
    }
  }

  private claim(entry: string): Promise<void> {
    const pending = this.claims.get(entry);
    if (pending !== undefined) {
      return pending;
    }
    const claimed = this.lease
      .add(entry)
      .then(() => waitWhileCacheLocked(this.path, PRUNE_LOCK, this.fs));
    this.claims.set(entry, claimed);
    return claimed;
  }

  /**
   * Claims the folder of `module` in the cache, as {@link claimFolder} does,
   * and returns its path. Unless `noClean`, it removes what the folder holds;
   * unless `noCreate`, it creates the folder.
   *
   * @throws when it would remove a folder that the live run of another
   * process leases, since that run may be reading it.
   */
  async getFolder(
    module: string,
    noClean?: boolean,
    noCreate?: boolean,
  ): Promise<string> {
    const folder = path.join(this.path, module);
    const entry = await findCacheEntry(this.path, folder);
    if (entry !== undefined) {
      await this.claim(entry);
    }
    if (!noClean) {
      await this.removeFolder(folder, entry);
    }
    if (!noCreate) {
      await this.fs.mkdir(folder, { recursive: true });
    }
    return folder;
  }

  private async removeFolder(
    folder: string,
    entry: string | undefined,
  ): Promise<void> {
    if (entry !== undefined && (await this.fs.exists(folder))) {
      const leases = await readOtherLiveLeases(this.path, this.fs);
      const holder = leases.find((lease) =>
        lease.entries.some((leased) => entryCovers(leased, entry)),
      );
      if (holder !== undefined) {
        throw new Error(
          `Cannot replace ${entry} in ${this.path}: the run with pid ${holder.pid} on ${holder.host} uses it (lease ${holder.file}). Stop that run, or wait for it to exit, then try again. If that run is gone, delete ${holder.file}.`,
        );
      }
    }
    await this.fs.rm(folder, { recursive: true, force: true });
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
    this.manifest.forget(module);
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
   * once it is released; before each move the prune checks that it still
   * holds the lock, and stops once another process has taken it over. A run
   * whose lease the file system refused does not prune, since no lease
   * protects what it loaded. Nothing is removed while
   * the lease of a run on another machine or in another pid namespace is
   * present, since this process cannot tell whether that run still lives,
   * and over a shared file system it may not see that run's newest lease. A
   * manifest key outside the cache or under a dot folder is never removed.
   *
   * @throws when a lease cannot be parsed, with nothing removed.
   */
  async prune(readKeep: () => Promise<CacheKeep>): Promise<void> {
    await this.manifest.settled();
    if (await this.lease.wasRefused()) {
      Logger.Warn(
        `Cannot write a lease in ${this.path}; not removing unused modules`,
      );
      return;
    }
    await this.emptyTrash();
    const lock = await tryAcquireCacheLock(this.path, PRUNE_LOCK, this.fs);
    if (lock === undefined) {
      Logger.Debug(`Another process prunes ${this.path}; skipping`);
      return;
    }
    let trashed: string[];
    try {
      trashed = await this.moveUnusedToTrash(readKeep, lock);
    } finally {
      await lock.release();
    }
    await this.removeAll(trashed);
  }

  private async moveUnusedToTrash(
    readKeep: () => Promise<CacheKeep>,
    lock: CacheLock,
  ): Promise<string[]> {
    await this.load();
    const leases = await readLiveLeases(this.path, this.fs);
    const foreign = leases.find(isForeignProcess);
    if (foreign !== undefined) {
      Logger.Warn(
        `Not removing unused modules: the run with pid ${foreign.pid} on ${foreign.host} (${foreign.namespace}) holds the lease ${foreign.file} from another machine or pid namespace. If that run is gone, delete ${foreign.file}.`,
      );
      return [];
    }
    const leased = leases.flatMap((lease) => lease.entries);
    const keep = await readKeep();
    const unused = this.entries()
      .map(([key]) => key)
      .filter(
        (key) =>
          isPrunableKey(this.path, key) &&
          !keep(key) &&
          !leased.some((entry) => entryCovers(entry, key)),
      );
    return this.trashEntries(unused, lock);
  }

  /** Moves the folders of `keys` to the trash and forgets them, while `lock` is held. */
  private async trashEntries(
    keys: string[],
    lock: CacheLock,
  ): Promise<string[]> {
    const trash = path.join(this.path, TRASH_FOLDER);
    const removed: string[] = [];
    const trashed: string[] = [];
    for (const key of keys) {
      if (!(await lock.isHeld())) {
        Logger.Warn(
          `Another process took over the prune lock of ${this.path}; not removing unused modules`,
        );
        break;
      }
      await this.fs.mkdir(trash, { recursive: true });
      const target = path.join(trash, randomUUID());
      const outcome = await this.moveToTrash(path.join(this.path, key), target);
      if (outcome !== "kept") {
        removed.push(key);
      }
      if (outcome === "moved") {
        trashed.push(target);
      }
    }
    if (removed.length > 0) {
      removed.forEach((key) => this.manifest.forget(key));
      await this.save();
    }
    return trashed;
  }

  private async moveToTrash(
    source: string,
    target: string,
  ): Promise<TrashOutcome> {
    try {
      await this.fs.rename(source, target);
      return "moved";
    } catch (error) {
      if (error instanceof Error && hasErrorCode(error, "ENOENT")) {
        return "absent";
      }
      Logger.Debug(`Could not move ${source} out of the cache; keeping it`);
      return "kept";
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
