import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import * as path from "node:path";
import { maxSatisfying, valid, validRange } from "semver";

import type { IFileSystem } from "../../types";
import {
  MissingModuleLockError,
  ModuleLockStore,
  type ModuleLockKey,
  type ModuleLockMode,
  type ModuleLockRecord,
} from "../modules";
import { findModuleLockfile } from "../output";

/** The module locks a package downloader replays and records. */
export interface PackageLockPolicy {
  store: ModuleLockStore;
  mode: ModuleLockMode;
}

const Logger = new Logging.Channel("loader.package");

/**
 * Applies a {@link PackageLockPolicy} to package modules: which version a
 * range resolves to, which lockfile to install from, whether the cached copy
 * still matches, and what to record once installed. Without a policy every
 * method keeps the downloader's behaviour without locks.
 */
export class PackageLocks {
  constructor(
    private readonly policy: PackageLockPolicy | undefined,
    private readonly fs: IFileSystem,
  ) {}

  /** Whether a cached module may be reused instead of downloaded again. */
  get reusesCache(): boolean {
    return this.policy?.mode !== "refresh";
  }

  /**
   * The highest recorded version that the range of `source` accepts, so a
   * locked range does not move when the registry publishes a newer version.
   */
  async recordedVersion(
    source: ModuleSourcePackage,
  ): Promise<string | undefined> {
    const range = validRange(source.version);
    if (
      !this.policy ||
      this.policy.mode === "refresh" ||
      valid(source.version) !== null ||
      range === null
    ) {
      return undefined;
    }
    const versions = await this.policy.store.versions(source.package);
    return maxSatisfying(versions, range) ?? undefined;
  }

  /**
   * The record to install `key` from. Throws in `frozen` mode when the
   * project has none.
   */
  async find(key: ModuleLockKey): Promise<ModuleLockRecord | undefined> {
    if (!this.policy || this.policy.mode === "refresh") {
      return undefined;
    }
    const record = await this.policy.store.read(key);
    if (!record && this.policy.mode === "frozen") {
      throw new MissingModuleLockError(key);
    }
    return record;
  }

  /** Whether the module cached in `folder` was installed from `record`. */
  async matches(
    folder: string,
    record: ModuleLockRecord | undefined,
  ): Promise<boolean> {
    if (!record) {
      return true;
    }
    const cached = path.join(folder, record.lockfile);
    if (!(await this.fs.exists(cached))) {
      return false;
    }
    return (await this.fs.readFileString(cached)) === record.content;
  }

  /** Writes `record` into `folder`, so the install there is frozen to it. */
  async replay(
    folder: string,
    record: ModuleLockRecord | undefined,
  ): Promise<void> {
    if (!record) {
      return;
    }
    Logger.Debug(
      `Installing ${record.package}@${record.version} from ${ModuleLockStore.relativePath(record)}`,
    );
    await this.fs.writeFile(path.join(folder, record.lockfile), record.content);
  }

  /**
   * Records the lockfile the package manager wrote in `folder` for `key`,
   * unless the module was installed from a record.
   */
  async keep(
    key: ModuleLockKey,
    folder: string,
    record: ModuleLockRecord | undefined,
  ): Promise<void> {
    const writes =
      this.policy?.mode === "record" || this.policy?.mode === "refresh";
    if (!this.policy || !writes || record) {
      return;
    }
    const lockfile = await findModuleLockfile(folder, this.fs);
    if (lockfile === undefined) {
      Logger.Debug(`No lockfile to record for ${key.package}@${key.version}`);
      return;
    }
    const content = await this.fs.readFileString(path.join(folder, lockfile));
    await this.policy.store.write({ ...key, lockfile, content });
  }
}
