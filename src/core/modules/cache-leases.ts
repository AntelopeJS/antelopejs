import { Logging } from "@antelopejs/interface-core/logging";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { IFileSystem } from "../../types";
import { isNumber, isObject, isProcessAlive, isString } from "../../utils";

/** A process that holds a file in a cache folder: the machine it runs on and its pid. */
export interface ProcessRef {
  host: string;
  pid: number;
}

/**
 * What `<cache>/.leases/<host>-<pid>-<uuid>.json` holds: the cache entries one
 * run resolves, as paths relative to the cache folder with `/` separators.
 */
interface RunLease extends ProcessRef {
  entries: string[];
}

const LEASES_FOLDER = ".leases";
const LEASE_EXTENSION = ".json";
const TEMP_SUFFIX = ".tmp";
const UNSAFE_NAME_CHARACTERS = /[^A-Za-z0-9_.-]/g;
const READ_ONLY_CODES = ["EACCES", "EPERM", "EROFS"];

const Logger = new Logging.Channel("loader");

/** Whether `error` is a system error with `code`, such as `ENOENT`. */
export function hasErrorCode(error: Error, code: string): boolean {
  const systemError: NodeJS.ErrnoException = error;
  return systemError.code === code;
}

function isPid(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value > 0;
}

/** Whether `value` names a process as {@link ProcessRef} does. */
export function isProcessRef(value: unknown): value is ProcessRef {
  return isObject(value) && isString(value.host) && isPid(value.pid);
}

function isRunLease(value: unknown): value is RunLease {
  return (
    isObject(value) &&
    isString(value.host) &&
    isPid(value.pid) &&
    Array.isArray(value.entries) &&
    value.entries.every(isString)
  );
}

/** This process, as a {@link ProcessRef}. */
export function currentProcess(): ProcessRef {
  return { host: os.hostname(), pid: process.pid };
}

/**
 * Whether the process `ref` names may still run. A process on another machine
 * cannot be probed, so it counts as running.
 */
export function isLiveProcess(ref: ProcessRef): boolean {
  return ref.host !== os.hostname() || isProcessAlive(ref.pid);
}

const heldLeases = new Set<string>();

function unlinkIfPresent(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    return;
  }
}

function releaseHeldLeases(): void {
  for (const file of heldLeases) {
    unlinkIfPresent(file);
    unlinkIfPresent(`${file}${TEMP_SUFFIX}`);
  }
}

function releaseAtExit(file: string): void {
  if (heldLeases.size === 0) {
    process.once("exit", releaseHeldLeases);
  }
  heldLeases.add(file);
}

function leaseFileName(owner: ProcessRef): string {
  const name = `${owner.host}-${owner.pid}-${randomUUID()}`;
  return `${name.replace(UNSAFE_NAME_CHARACTERS, "_")}${LEASE_EXTENSION}`;
}

/**
 * The lease file of one run on a cache folder. The file is created on the
 * first write and removed when the process exits. Writes replace it whole
 * and run one after another, each with the entries known when it runs, so a
 * later write never lands an older set.
 */
export class RunLeaseFile {
  private file?: string;
  private readonly entries = new Set<string>();
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly cachePath: string,
    private readonly fs: IFileSystem,
  ) {}

  /**
   * Adds `entry` to the lease; resolves once the lease file names it. On a
   * cache this process may not write, it resolves with no lease written,
   * since this process cannot prune that cache either.
   */
  add(entry: string): Promise<void> {
    this.entries.add(entry);
    const write = this.pendingWrite.then(() => this.performWrite());
    this.pendingWrite = write.catch(() => undefined);
    return write;
  }

  private async performWrite(): Promise<void> {
    const owner = currentProcess();
    const folder = path.join(this.cachePath, LEASES_FOLDER);
    if (this.file === undefined) {
      this.file = path.join(folder, leaseFileName(owner));
      releaseAtExit(this.file);
    }
    const lease: RunLease = { ...owner, entries: [...this.entries] };
    const temp = `${this.file}${TEMP_SUFFIX}`;
    try {
      await this.fs.mkdir(folder, { recursive: true });
      await this.fs.writeFile(temp, JSON.stringify(lease));
      await this.fs.rename(temp, this.file);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !READ_ONLY_CODES.some((code) => hasErrorCode(error, code))
      ) {
        throw error;
      }
      Logger.Debug(`Cannot write a lease in ${folder}; running without one`);
    }
  }
}

/** The names in `folder`, none when it does not exist. */
export async function readFolderNames(
  folder: string,
  fs: IFileSystem,
): Promise<string[]> {
  if (!(await fs.exists(folder))) {
    return [];
  }
  return fs.readdir(folder);
}

async function readLease(
  file: string,
  fs: IFileSystem,
): Promise<RunLease | undefined> {
  let content: string;
  try {
    content = await fs.readFileString(file);
  } catch (error) {
    if (error instanceof Error && hasErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
  const lease: unknown = JSON.parse(content);
  if (!isRunLease(lease)) {
    throw new Error(`The cache lease ${file} does not hold a run lease`);
  }
  return lease;
}

/**
 * The entries the leases of every live run on the cache at `cachePath` name.
 * The lease of a dead process on this machine is deleted, and a lease that
 * disappears while it is read is skipped.
 *
 * @throws when a lease file cannot be parsed, since the entries it names
 * are then unknown.
 */
export async function readLiveLeaseEntries(
  cachePath: string,
  fs: IFileSystem,
): Promise<string[]> {
  const folder = path.join(cachePath, LEASES_FOLDER);
  const names = await readFolderNames(folder, fs);
  const entries: string[] = [];
  for (const name of names.filter((item) => item.endsWith(LEASE_EXTENSION))) {
    const file = path.join(folder, name);
    const lease = await readLease(file, fs);
    if (lease === undefined) {
      continue;
    }
    if (!isLiveProcess(lease)) {
      await fs.rm(file, { force: true });
      continue;
    }
    entries.push(...lease.entries);
  }
  return entries;
}
