import { Logging } from "@antelopejs/interface-core/logging";
import { randomUUID } from "node:crypto";
import * as fsNode from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { satisfies } from "semver";

import type { IFileSystem } from "../../types";
import { NodeFileSystem } from "../filesystem";
import {
  acquireCacheLock,
  type CacheLock,
  downloadLockOf,
  PRUNE_LOCK,
  tryAcquireCacheLock,
  waitWhileCacheLocked,
} from "./cache-lock";
import {
  describeRefusal,
  hasErrorCode,
  type HeldLease,
  isForeignProcess,
  readFolderNames,
  readLiveLeases,
  readOtherLiveLeases,
  RunLeaseFile,
} from "./cache-leases";
import { CacheManifest } from "./cache-manifest";

const Logger = new Logging.Channel("loader");

const TRASH_FOLDER = ".trash";
const HELD_CHECKS = 3;
const HELD_CHECK_PAUSE_MS = 25;

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

function describeHolder(lease: HeldLease): string {
  return `the run with pid ${lease.pid} on ${lease.host} (lease ${lease.file})`;
}

/** The download locks this process holds, by {@link downloadKey}. */
const heldDownloads = new Map<string, CacheLock>();

function downloadKey(cachePath: string, module: string): string {
  return `${path.resolve(cachePath)}\n${module}`;
}

export class ModuleCache {
  private readonly manifest: CacheManifest;
  private readonly claims = new Map<string, Promise<void>>();
  private readonly keptInUse = new Set<string>();
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
      .then(() => waitWhileCacheLocked(this.path, PRUNE_LOCK, this.fs))
      .then(() => this.waitForOtherDownloads(entry));
    this.claims.set(entry, claimed);
    return claimed;
  }

  /**
   * Waits while another process downloads into the folder of `entry`: the
   * download lock of each manifest key that could hold it, such as `pkg@1.0.0`
   * or `@scope/pkg@1.0.0` for `@scope/pkg@1.0.0/dist`. A lock this process
   * holds is not waited for, since its own download claims its folder.
   */
  private async waitForOtherDownloads(entry: string): Promise<void> {
    const segments = entry.split("/");
    for (let count = 1; count <= segments.length; count++) {
      const key = segments.slice(0, count).join("/");
      if (!heldDownloads.has(downloadKey(this.path, key))) {
        await waitWhileCacheLocked(this.path, downloadLockOf(key), this.fs);
      }
    }
  }

  /**
   * Claims the folder of `module` in the cache, as {@link claimFolder} does,
   * and returns its path. Unless `noClean`, it removes what the folder holds,
   * and the manifest entry of `module` with it; unless `noCreate`, it creates
   * the folder.
   *
   * @throws when it would remove a folder that the live run of another
   * process leases, since that run may be reading it. A downloader that finds
   * such a folder complete keeps it instead of replacing it.
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
      await this.ensureDownloadLockHeld(module);
      await this.removeFolder(module, folder);
    }
    if (!noCreate) {
      await this.fs.mkdir(folder, { recursive: true });
    }
    return folder;
  }

  private async removeFolder(module: string, folder: string): Promise<void> {
    if (await this.fs.exists(folder)) {
      const holder = await this.findOtherLease(module);
      if (holder !== undefined) {
        throw new Error(
          `Cannot replace ${module} in ${this.path}: ${describeHolder(holder)} uses it, and its folder is incomplete. Stop that run, or wait for it to exit, then try again. If that run is gone, delete ${holder.file}.`,
        );
      }
    }
    await this.clearVersion(module);
    await this.fs.rm(folder, { recursive: true, force: true });
  }

  /**
   * Records that a downloader kept the folder of `module` as it is, because
   * another live run uses it, instead of downloading it again.
   */
  markKeptInUse(module: string): void {
    this.keptInUse.add(module);
  }

  /** Whether a downloader kept the folder of `module` because another live run uses it. */
  wasKeptInUse(module: string): boolean {
    return this.keptInUse.has(module);
  }

  /**
   * The lease of the live run of another process, or of another machine or
   * pid namespace, that covers the folder of `module`, if any.
   */
  async findOtherLease(module: string): Promise<HeldLease | undefined> {
    const entry = await findCacheEntry(this.path, path.join(this.path, module));
    if (entry === undefined) {
      return undefined;
    }
    const leases = await readOtherLiveLeases(this.path, this.fs);
    return leases.find((lease) =>
      lease.entries.some((leased) => entryCovers(leased, entry)),
    );
  }

  /**
   * Runs `run` while this process holds the download lock of `module`, so
   * that one run at a time downloads it into the cache: a run that downloads
   * it meanwhile is waited for. When the cache refuses the lock, as a
   * read-only cache does, `run` runs without it.
   */
  async withDownloadLock<T>(module: string, run: () => Promise<T>): Promise<T> {
    let lock: CacheLock | undefined;
    try {
      lock = await acquireCacheLock(this.path, downloadLockOf(module), this.fs);
    } catch (error) {
      const refusal = describeRefusal(
        error instanceof Error ? error : new Error(String(error)),
      );
      Logger[refusal.level](
        `Cannot take the download lock of ${module} in ${this.path} (${refusal.failure}); going on without it`,
      );
    }
    const held = downloadKey(this.path, module);
    if (lock !== undefined) {
      heldDownloads.set(held, lock);
    }
    try {
      return await run();
    } finally {
      heldDownloads.delete(held);
      await lock?.release();
    }
  }

  /**
   * Checks, when this process holds the download lock of `module`, that the
   * lock still holds the token of this hold. A downloader calls it before
   * each step that replaces the folder of `module`, and `getFolder` and
   * `commitVersion` call it before they clean the folder and list it.
   *
   * A check that finds another owner, or none it can read, is tried again
   * after a pause, up to three times, since on Windows a read of
   * `owner.json` fails while the heartbeat of this process renames it.
   *
   * @throws when another process took the lock over, as after this process
   * stalled for 60 s, since that process now downloads `module`.
   */
  async ensureDownloadLockHeld(module: string): Promise<void> {
    const lock = heldDownloads.get(downloadKey(this.path, module));
    if (lock === undefined) {
      return;
    }
    for (let check = 1; check < HELD_CHECKS; check += 1) {
      if (await lock.isHeld()) {
        return;
      }
      await delay(HELD_CHECK_PAUSE_MS);
    }
    if (!(await lock.isHeld())) {
      throw new Error(
        `Another process took over the download lock of ${module} in ${this.path}; this run stopped so that it does not write over that download. Run the command again.`,
      );
    }
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

  /**
   * Lists `module` at `version` in the manifest and saves it.
   *
   * @throws when another process took over the download lock of `module`
   * that this process holds, as {@link ensureDownloadLockHeld} checks.
   */
  async commitVersion(module: string, version: string): Promise<void> {
    await this.ensureDownloadLockHeld(module);
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
   * protects what it loaded. Nothing is removed while the lease of a run on
   * another machine or in another pid namespace is present, since this
   * process cannot tell whether that run still lives, and over a shared file
   * system it may not see that run's newest lease. A manifest key outside the
   * cache or under a dot folder is never removed.
   *
   * @throws when a lease cannot be parsed, with nothing removed.
   */
  async prune(readKeep: () => Promise<CacheKeep>): Promise<void> {
    await this.manifest.settled();
    const refusal = await this.lease.refusal();
    if (refusal !== undefined) {
      Logger[refusal.level](
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
    const foreign = leases.filter(isForeignProcess);
    if (foreign.length > 0) {
      const holders = foreign
        .map((lease) => `${describeHolder(lease)} in ${lease.namespace}`)
        .join("; ");
      Logger.Warn(
        `Not removing unused modules: these runs on another machine or in another pid namespace hold leases: ${holders}. If those runs are gone, delete their lease files, or run ajs project modules release-leases --foreign.`,
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
