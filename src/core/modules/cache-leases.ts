import { Logging } from "@antelopejs/interface-core/logging";
import { randomUUID } from "node:crypto";
import { readlinkSync, unlinkSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { IFileSystem } from "../../types";
import { isNumber, isObject, isProcessAlive, isString } from "../../utils";

/**
 * A process that holds a file in a cache folder: the machine it runs on, its
 * pid namespace (`/proc/self/ns/pid` on Linux, `none` where it cannot be
 * read) and its pid in that namespace.
 */
export interface ProcessRef {
  host: string;
  namespace: string;
  pid: number;
}

/**
 * What `<cache>/.leases/<host>-<namespace>-<pid>-<uuid>.json` holds: the
 * cache entries one run resolves, as paths relative to the cache folder with
 * `/` separators.
 */
interface RunLease extends ProcessRef {
  entries: string[];
}

const LEASES_FOLDER = ".leases";
const LEASE_EXTENSION = ".json";
const TEMP_SUFFIX = ".tmp";
const UNSAFE_NAME_CHARACTERS = /[^A-Za-z0-9_.-]/g;
const LEASE_NAME = /^(.+)-(\d+)-([1-9]\d*)-[0-9a-f]{8}-[0-9a-f-]{27}\.json$/;
const PID_NAMESPACE_LINK = "/proc/self/ns/pid";
const NO_NAMESPACE = "none";
const NAMESPACE_DIGITS = /\d+/;
const READ_ONLY_CODES = ["EACCES", "EPERM", "EROFS", "ENOENT"];

const Logger = new Logging.Channel("loader");

/** Whether `error` is a system error with `code`, such as `ENOENT`. */
export function hasErrorCode(error: Error, code: string): boolean {
  const systemError: NodeJS.ErrnoException = error;
  return systemError.code === code;
}

/** The system error code of `error`, such as `ENOSPC`, or its message. */
function failureCode(error: Error): string {
  const systemError: NodeJS.ErrnoException = error;
  return systemError.code ?? error.message;
}

/**
 * A write to the cache that the file system refused: its system error code
 * or message, and the level a run logs it at, debug on a cache this process
 * may not write (`EACCES`, `EPERM`, `EROFS`, `ENOENT`) and a warning
 * otherwise, such as on a full disk.
 */
export interface CacheRefusal {
  failure: string;
  level: "Debug" | "Warn";
}

/** The {@link CacheRefusal} that `error`, thrown by a write to the cache, stands for. */
export function describeRefusal(error: Error): CacheRefusal {
  const failure = failureCode(error);
  return {
    failure,
    level: READ_ONLY_CODES.includes(failure) ? "Debug" : "Warn",
  };
}

function isPid(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value > 0;
}

/** Whether `value` names a process as {@link ProcessRef} does. */
export function isProcessRef(value: unknown): value is ProcessRef {
  return (
    isObject(value) &&
    isString(value.host) &&
    isString(value.namespace) &&
    isPid(value.pid)
  );
}

function isRunLease(value: unknown): value is RunLease {
  return (
    isProcessRef(value) &&
    isObject(value) &&
    Array.isArray(value.entries) &&
    value.entries.every(isString)
  );
}

function readPidNamespace(): string {
  try {
    return readlinkSync(PID_NAMESPACE_LINK);
  } catch {
    return NO_NAMESPACE;
  }
}

const pidNamespace = readPidNamespace();

/** This process, as a {@link ProcessRef}. */
export function currentProcess(): ProcessRef {
  return { host: os.hostname(), namespace: pidNamespace, pid: process.pid };
}

/**
 * Whether `ref` runs on another machine or in another pid namespace, where
 * this process cannot tell whether its pid still runs.
 */
export function isForeignProcess(ref: ProcessRef): boolean {
  return ref.host !== os.hostname() || ref.namespace !== pidNamespace;
}

/**
 * Whether the process `ref` names may still run. A foreign process (see
 * {@link isForeignProcess}) cannot be probed, so it counts as running.
 */
export function isLiveProcess(ref: ProcessRef): boolean {
  return isForeignProcess(ref) || isProcessAlive(ref.pid);
}

function isThisProcess(ref: ProcessRef): boolean {
  return !isForeignProcess(ref) && ref.pid === process.pid;
}

/**
 * What the core can tell of the run that holds a lease: it lives, it has
 * exited, or it is foreign, on another machine or pid namespace or named by
 * no readable owner, so that whether it lives is unknown.
 */
export type LeaseState = "live" | "exited" | "foreign";

function stateOf(ref: ProcessRef): LeaseState {
  if (isForeignProcess(ref)) {
    return "foreign";
  }
  return isProcessAlive(ref.pid) ? "live" : "exited";
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

function namespaceDigits(namespace: string): string {
  return NAMESPACE_DIGITS.exec(namespace)?.[0] ?? "0";
}

function leaseFileName(owner: ProcessRef): string {
  const namespace = namespaceDigits(owner.namespace);
  const name = `${owner.host}-${namespace}-${owner.pid}-${randomUUID()}`;
  return `${name.replace(UNSAFE_NAME_CHARACTERS, "_")}${LEASE_EXTENSION}`;
}

/**
 * The state of the run that the lease file `name` names, as
 * {@link leaseFileName} spells it. It decides on a lease whose content cannot
 * be read, such as one a power loss left empty; a name spelled otherwise is
 * foreign.
 */
function stateFromName(name: string): LeaseState {
  const match = LEASE_NAME.exec(name);
  if (match === null) {
    return "foreign";
  }
  const [, host, namespace, pid] = match;
  const thisHost = os.hostname().replace(UNSAFE_NAME_CHARACTERS, "_");
  if (host !== thisHost || namespace !== namespaceDigits(pidNamespace)) {
    return "foreign";
  }
  return isProcessAlive(Number(pid)) ? "live" : "exited";
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
  private refused?: CacheRefusal;

  constructor(
    private readonly cachePath: string,
    private readonly fs: IFileSystem,
  ) {}

  /**
   * How the file system refused a write of this lease, so that no prune sees
   * the entries of this run, or `undefined` when no write was refused. It
   * waits for the pending writes first.
   */
  async refusal(): Promise<CacheRefusal | undefined> {
    await this.pendingWrite;
    return this.refused;
  }

  /**
   * Adds `entry` to the lease; resolves once the lease file names it. When a
   * write fails, whatever the error, it resolves with no lease written, and
   * {@link refusal} returns the refusal: the run goes on without a lease and
   * does not prune. The first failure is logged at the level of its
   * {@link CacheRefusal}.
   */
  add(entry: string): Promise<void> {
    this.entries.add(entry);
    this.pendingWrite = this.pendingWrite.then(() => this.performWrite());
    return this.pendingWrite;
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
      this.refuse(
        folder,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private refuse(folder: string, error: Error): void {
    if (this.refused === undefined) {
      const refusal = describeRefusal(error);
      Logger[refusal.level](
        `Cannot write a lease in ${folder} (${refusal.failure}); running without one`,
      );
      this.refused = refusal;
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

async function listLeaseFiles(
  cachePath: string,
  fs: IFileSystem,
): Promise<string[]> {
  const folder = path.join(cachePath, LEASES_FOLDER);
  const names = await readFolderNames(folder, fs);
  return names
    .filter((name) => name.endsWith(LEASE_EXTENSION))
    .map((name) => path.join(folder, name));
}

/** A run lease read from disk, with the path of its file. */
export interface HeldLease extends RunLease {
  file: string;
}

async function readLease(
  file: string,
  fs: IFileSystem,
): Promise<HeldLease | undefined> {
  let content: string;
  try {
    content = await fs.readFileString(file);
  } catch (error) {
    if (error instanceof Error && hasErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
  let lease: unknown;
  try {
    lease = JSON.parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The cache lease ${file} is not JSON (${reason})`);
  }
  if (!isRunLease(lease)) {
    throw new Error(`The cache lease ${file} does not hold a run lease`);
  }
  return { ...lease, file };
}

/**
 * The leases of every live run on the cache at `cachePath`; a foreign run
 * counts as live. The lease of an exited process of this machine and pid
 * namespace is deleted, and a lease that disappears while it is read is
 * skipped. No foreign lease is deleted.
 *
 * @throws when a lease file cannot be parsed, since the entries it names
 * are then unknown.
 */
export async function readLiveLeases(
  cachePath: string,
  fs: IFileSystem,
): Promise<HeldLease[]> {
  const leases: HeldLease[] = [];
  for (const file of await listLeaseFiles(cachePath, fs)) {
    let lease: HeldLease | undefined;
    try {
      lease = await readLease(file, fs);
    } catch (error) {
      if (stateFromName(path.basename(file)) !== "exited") {
        throw error;
      }
      await fs.rm(file, { force: true });
      continue;
    }
    if (lease === undefined) {
      continue;
    }
    if (stateOf(lease) === "exited") {
      await fs.rm(file, { force: true });
      continue;
    }
    leases.push(lease);
  }
  return leases;
}

/**
 * The leases of the live runs of other processes on the cache at
 * `cachePath`; a foreign run counts as live. It deletes nothing, and skips a
 * lease that cannot be read.
 */
export async function readOtherLiveLeases(
  cachePath: string,
  fs: IFileSystem,
): Promise<HeldLease[]> {
  const leases: HeldLease[] = [];
  for (const file of await listLeaseFiles(cachePath, fs)) {
    const lease = await readLease(file, fs).catch(() => undefined);
    if (lease !== undefined && !isThisProcess(lease) && isLiveProcess(lease)) {
      leases.push(lease);
    }
  }
  return leases;
}

/** A lease file of a cache, with the state of the run that holds it. */
export interface LeaseStatus {
  file: string;
  state: LeaseState;
  /** What the lease holds, `undefined` when its file cannot be parsed. */
  lease: RunLease | undefined;
}

async function readLeaseStatus(
  file: string,
  fs: IFileSystem,
): Promise<LeaseStatus | undefined> {
  try {
    const lease = await readLease(file, fs);
    return lease === undefined
      ? undefined
      : { file, state: stateOf(lease), lease };
  } catch {
    return {
      file,
      state: stateFromName(path.basename(file)),
      lease: undefined,
    };
  }
}

/**
 * Every lease of the cache at `cachePath`, with the state of its run. A lease
 * whose file cannot be parsed is judged by its file name, and one removed
 * while it is read is skipped. It deletes nothing.
 */
export async function readLeaseStatuses(
  cachePath: string,
  fs: IFileSystem,
): Promise<LeaseStatus[]> {
  const statuses: LeaseStatus[] = [];
  for (const file of await listLeaseFiles(cachePath, fs)) {
    const status = await readLeaseStatus(file, fs);
    if (status !== undefined) {
      statuses.push(status);
    }
  }
  return statuses;
}
