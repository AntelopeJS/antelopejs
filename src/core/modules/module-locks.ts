import * as path from "node:path";
import { maxSatisfying, valid, validRange } from "semver";

import type { IFileSystem } from "../../types";
import { NodeFileSystem } from "../filesystem";
import {
  CliError,
  getProcessUi,
  MODULE_LOCKFILE_NAMES,
  pluralize,
} from "../output";

/** Folder of the project, next to `antelope.config.ts`, that holds the module locks. */
export const MODULE_LOCK_FOLDER = "antelope-lock";

/**
 * How package modules use the project's module locks.
 *
 * - `record`: replay the lock of a module when the project has one, and record
 *   the lockfile the package manager wrote when it has none.
 * - `frozen`: replay the lock of a module, and fail when the project has none.
 * - `replay`: replay the lock of a module when the project has one, and never
 *   write the project's locks, as a running project's folder may be read-only.
 * - `refresh`: ignore the recorded lock, resolve the dependencies again and
 *   record the result.
 */
export type ModuleLockMode = "record" | "frozen" | "replay" | "refresh";

/** A package module at one exact version. */
export interface ModuleLockKey {
  package: string;
  version: string;
}

/** The lockfile recorded for a package module at one exact version. */
export interface ModuleLockRecord extends ModuleLockKey {
  /** File name of the lockfile, such as `pnpm-lock.yaml` or `package-lock.json`. */
  lockfile: string;
  content: string;
}

/** What writing a record did to the project. */
export type ModuleLockChange = "added" | "changed" | "unchanged";

const BUILD_COMMAND = "ajs project build";
const UPDATE_COMMAND = "ajs project modules update";

/**
 * A `frozen` install of a package module the project has no lock for. Fatal
 * even for an optional module: a frozen build must not drop it silently.
 */
export class MissingModuleLockError extends CliError {
  constructor(key: ModuleLockKey) {
    super({
      title: `No module lock for ${key.package}${VERSION_SEPARATOR}${key.version}`,
      reason: `--frozen-modules installs only from ${ModuleLockStore.relativePath(key)}, and the project has none.`,
      fixes: [
        `Run ${BUILD_COMMAND} without --frozen-modules (or ${UPDATE_COMMAND} ${key.package}) and commit the lock it writes`,
      ],
    });
  }
}

/** A package module of the configuration, with the version or range it asks for. */
export interface ModuleLockRequirement {
  package: string;
  spec: string;
}

const PACKAGE_NAME_PATTERN = /^(?:@[A-Za-z0-9][\w.~-]*\/)?[A-Za-z0-9][\w.~-]*$/;
const VERSION_SEPARATOR = "@";
const SCOPE_PREFIX = "@";

/**
 * The key of a record: the exact version without its `v` or `=` prefix and
 * build metadata, so `v1.0.0` and `1.0.0` name the same record.
 */
function normalizeKey(key: ModuleLockKey): ModuleLockKey {
  const version = valid(key.version);
  if (!PACKAGE_NAME_PATTERN.test(key.package) || version === null) {
    throw new Error(
      `Invalid module lock key ${key.package}${VERSION_SEPARATOR}${key.version}`,
    );
  }
  return { package: key.package, version };
}

function parseRecordName(name: string): ModuleLockKey | undefined {
  const separator = name.lastIndexOf(VERSION_SEPARATOR);
  if (separator <= 0) {
    return undefined;
  }
  const key = {
    package: name.slice(0, separator),
    version: name.slice(separator + 1),
  };
  const isValid =
    PACKAGE_NAME_PATTERN.test(key.package) && valid(key.version) !== null;
  return isValid ? key : undefined;
}

function recordName(key: ModuleLockKey): string {
  const { package: pkg, version } = normalizeKey(key);
  return `${pkg}${VERSION_SEPARATOR}${version}`;
}

/**
 * Versions of `requirement` whose locks stay: the exact version it pins, the
 * highest recorded version its range accepts, or every recorded version when
 * it names a dist-tag that only the registry can resolve.
 */
function keptVersions(
  requirement: ModuleLockRequirement,
  recorded: string[],
): string[] {
  const exact = valid(requirement.spec);
  if (exact !== null) {
    return [exact];
  }
  const range = validRange(requirement.spec);
  if (range === null) {
    return recorded;
  }
  const best = maxSatisfying(recorded, range);
  return best === null ? [] : [best];
}

/**
 * The module locks of a project: one native lockfile per package module and
 * version, at `antelope-lock/<package>@<version>/<lockfile>`. The lockfile is
 * the one the module's package manager wrote in the module cache, so a later
 * install with that lockfile resolves the same dependency versions.
 */
export class ModuleLockStore {
  readonly folder: string;
  private readonly recorded = new Map<string, ModuleLockKey>();

  constructor(
    projectFolder: string,
    private readonly fs: IFileSystem = new NodeFileSystem(),
  ) {
    this.folder = path.join(projectFolder, MODULE_LOCK_FOLDER);
  }

  /** Folder of the record of `key`, relative to the project. */
  static relativePath(key: ModuleLockKey): string {
    return path.join(MODULE_LOCK_FOLDER, recordName(key));
  }

  private recordFolder(key: ModuleLockKey): string {
    return path.join(this.folder, recordName(key));
  }

  async read(requested: ModuleLockKey): Promise<ModuleLockRecord | undefined> {
    const key = normalizeKey(requested);
    const folder = this.recordFolder(key);
    if (!(await this.fs.exists(folder))) {
      return undefined;
    }
    const entries = await this.fs.readdir(folder);
    const lockfile = MODULE_LOCKFILE_NAMES.find((name) =>
      entries.includes(name),
    );
    if (lockfile === undefined) {
      return undefined;
    }
    const content = await this.fs.readFileString(path.join(folder, lockfile));
    return { ...key, lockfile, content };
  }

  async write(record: ModuleLockRecord): Promise<ModuleLockChange> {
    const previous = await this.read(record);
    if (
      previous?.lockfile === record.lockfile &&
      previous.content === record.content
    ) {
      return "unchanged";
    }
    const folder = this.recordFolder(record);
    await this.fs.rm(folder, { recursive: true, force: true });
    await this.fs.mkdir(folder, { recursive: true });
    await this.fs.writeFile(path.join(folder, record.lockfile), record.content);
    this.recorded.set(recordName(record), normalizeKey(record));
    return previous ? "changed" : "added";
  }

  /** The records written since the last call. */
  takeRecorded(): ModuleLockKey[] {
    const keys = [...this.recorded.values()];
    this.recorded.clear();
    return keys;
  }

  async remove(key: ModuleLockKey): Promise<void> {
    await this.fs.rm(this.recordFolder(key), { recursive: true, force: true });
    const parent = path.dirname(this.recordFolder(key));
    if (
      parent !== this.folder &&
      (await this.fs.readdir(parent)).length === 0
    ) {
      await this.fs.rm(parent, { recursive: true, force: true });
    }
  }

  private async entryNames(folder: string): Promise<string[]> {
    return (await this.fs.exists(folder)) ? this.fs.readdir(folder) : [];
  }

  async list(): Promise<ModuleLockKey[]> {
    const names: string[] = [];
    for (const entry of await this.entryNames(this.folder)) {
      if (!entry.startsWith(SCOPE_PREFIX)) {
        names.push(entry);
        continue;
      }
      const scoped = await this.entryNames(path.join(this.folder, entry));
      names.push(...scoped.map((name) => `${entry}/${name}`));
    }
    return names.flatMap((name) => parseRecordName(name) ?? []);
  }

  async versions(pkg: string): Promise<string[]> {
    return (await this.list())
      .filter((key) => key.package === pkg)
      .map((key) => key.version);
  }

  /**
   * Removes the records no requirement keeps, and returns them.
   * @param requirements Every package module of every environment of the project
   */
  async prune(requirements: ModuleLockRequirement[]): Promise<ModuleLockKey[]> {
    const recorded = await this.list();
    const kept = new Set<string>();
    requirements.forEach((requirement) => {
      const versions = recorded
        .filter((key) => key.package === requirement.package)
        .map((key) => key.version);
      keptVersions(requirement, versions).forEach((version) =>
        kept.add(recordName({ package: requirement.package, version })),
      );
    });
    const removed = recorded.filter((key) => !kept.has(recordName(key)));
    for (const key of removed) {
      await this.remove(key);
    }
    return removed;
  }
}

/**
 * Prints one line for the records `store` wrote since the last report, so a
 * command that installs many modules does not print one line per module.
 */
export function reportRecordedLocks(store: ModuleLockStore): void {
  const count = store.takeRecorded().length;
  if (count === 0) {
    return;
  }
  getProcessUi().message(
    "info",
    `Recorded ${pluralize(count, "module lock")} in ${MODULE_LOCK_FOLDER}/: commit ${count === 1 ? "it" : "them"} so every install gets the same dependencies`,
  );
}
