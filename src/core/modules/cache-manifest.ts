import { randomUUID } from "node:crypto";
import * as path from "node:path";

import type { IFileSystem } from "../../types";
import { isPlainObject, isString } from "../../utils";
import { acquireCacheLock, type CacheLock, MANIFEST_LOCK } from "./cache-lock";

const MANIFEST_FILE = "manifest.json";

/** The versions this run set, or cleared as `undefined`, since its last save. */
type ManifestChanges = ReadonlyMap<string, string | undefined>;

/**
 * Applies to `manifest` each version of `changes`: a version sets its entry,
 * `undefined` removes it.
 */
function applyChanges(
  manifest: Record<string, string>,
  changes: ManifestChanges,
): void {
  for (const [module, version] of changes) {
    if (version === undefined) {
      delete manifest[module];
    } else {
      manifest[module] = version;
    }
  }
}

function isVersionManifest(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every(isString);
}

/**
 * The `manifest.json` of a cache as one run sees it: the entries it last
 * read, with the versions it set or cleared since on top.
 */
export class CacheManifest {
  private versions: Record<string, string> = {};
  private readonly changes = new Map<string, string | undefined>();
  private pendingSave: Promise<void> = Promise.resolve();

  constructor(
    private readonly cachePath: string,
    private readonly fs: IFileSystem,
  ) {}

  /**
   * Reads `manifest.json` again and applies the changes this run has not
   * saved yet. A file that cannot be read counts as empty.
   */
  async load(): Promise<void> {
    const read = (await this.read()) ?? {};
    applyChanges(read, this.changes);
    this.versions = read;
  }

  /**
   * The manifest on disk: empty when there is none yet, `undefined` when it
   * exists but cannot be read or does not map entries to versions.
   */
  private async read(): Promise<Record<string, string> | undefined> {
    const manifestPath = path.join(this.cachePath, MANIFEST_FILE);
    if (!(await this.fs.exists(manifestPath))) {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(
        await this.fs.readFileString(manifestPath),
      );
      return isVersionManifest(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  get(module: string): string | undefined {
    return Object.hasOwn(this.versions, module)
      ? this.versions[module]
      : undefined;
  }

  list(): [string, string][] {
    return Object.entries(this.versions);
  }

  set(module: string, version: string): void {
    this.versions[module] = version;
    this.changes.set(module, version);
  }

  forget(module: string): void {
    delete this.versions[module];
    this.changes.set(module, undefined);
  }

  /** Resolves once the saves started so far are done. */
  async settled(): Promise<void> {
    await this.pendingSave;
  }

  /**
   * Writes the changes of this run after the saves before it, under the
   * manifest lock of the cache, so that the saves of several processes all
   * land. Under the lock it re-reads `manifest.json` and applies only the
   * versions this run set or cleared, so that the entries another run
   * committed stay; when the file cannot be read again, it applies them to
   * the manifest this run holds instead, so that no entry it loaded is
   * dropped. It writes a temporary file renamed over `manifest.json`, so that
   * a run reading without the lock never reads it halfway. When another
   * process took the lock over meanwhile, it renames nothing and saves again.
   */
  save(): Promise<void> {
    this.pendingSave = this.pendingSave.then(() => this.writeChanges());
    return this.pendingSave;
  }

  private async writeChanges(): Promise<void> {
    const written = new Map(this.changes);
    let merged: Record<string, string> | undefined;
    while (merged === undefined) {
      const lock = await acquireCacheLock(
        this.cachePath,
        MANIFEST_LOCK,
        this.fs,
      );
      try {
        merged = await this.mergeUnderLock(written, lock);
      } finally {
        await lock.release();
      }
    }
    for (const [module, version] of written) {
      if (this.changes.get(module) === version) {
        this.changes.delete(module);
      }
    }
    applyChanges(merged, this.changes);
    this.versions = merged;
  }

  /**
   * Writes `written` over the manifest on disk while `lock` is held.
   *
   * @returns the manifest written, or `undefined` when the lock was lost
   * before the rename.
   */
  private async mergeUnderLock(
    written: ManifestChanges,
    lock: CacheLock,
  ): Promise<Record<string, string> | undefined> {
    const merged = (await this.read()) ?? { ...this.versions };
    applyChanges(merged, written);
    const manifestPath = path.join(this.cachePath, MANIFEST_FILE);
    const temp = `${manifestPath}.${randomUUID()}.tmp`;
    await this.fs.writeFile(temp, JSON.stringify(merged, null, 2));
    if (!(await lock.isHeld())) {
      await this.fs.rm(temp, { force: true });
      return undefined;
    }
    await this.fs.rename(temp, manifestPath);
    return merged;
  }
}
