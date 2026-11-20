import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { NodeFileSystem } from "../../src/core/filesystem";
import {
  isNumber,
  isObject,
  isParsedJson,
  isString,
  type ParsedJson,
} from "../../src/utils";
import type { JsonValue } from "./json";
import { readText, writeJson } from "./temp";

const LEASES_FOLDER = ".leases";
const LOCK_FOLDER = ".prune.lock";
const HELD_LOCK_TOKEN = "held-by-the-test";

/** A process as a lease or a prune lock names it. */
export interface LeaseOwner {
  host: string;
  namespace: string;
  pid: number;
}

/** The pid namespace of this process, read on its own so that it checks the core's reading. */
function pidNamespace(): string {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return "none";
  }
}

/** This process, as a lease or a prune lock names it. */
export function thisProcess(): LeaseOwner {
  return { host: os.hostname(), namespace: pidNamespace(), pid: process.pid };
}

/** A pid namespace other than the one of this process. */
export function otherNamespace(): string {
  return pidNamespace() === "pid:[1]" ? "pid:[2]" : "pid:[1]";
}

/**
 * Seeds the cache at `cachePath` with a package module for each
 * `<package>@1.0.0` entry, which a package source of that exact version loads
 * without the registry, and adds each entry to the manifest at `1.0.0`.
 */
export function seedCache(cachePath: string, entries: string[]): void {
  for (const entry of entries) {
    const folder = path.join(cachePath, entry);
    writeJson(path.join(folder, "package.json"), {
      name: entry.slice(0, entry.lastIndexOf("@")),
      version: "1.0.0",
      main: "index.js",
    });
    writeFileSync(path.join(folder, "index.js"), "module.exports = {};\n");
  }
  const recorded = existsSync(path.join(cachePath, "manifest.json"))
    ? manifestKeys(cachePath)
    : [];
  writeJson(
    path.join(cachePath, "manifest.json"),
    Object.fromEntries(
      [...recorded, ...entries].map((entry) => [entry, "1.0.0"]),
    ),
  );
}

/** Whether the folder of `entry` is still in the cache at `cachePath`. */
export function hasEntryFolder(cachePath: string, entry: string): boolean {
  return existsSync(path.join(cachePath, entry));
}

/** The keys of the manifest of the cache at `cachePath`. */
export function manifestKeys(cachePath: string): string[] {
  const manifest: unknown = JSON.parse(
    readText(path.join(cachePath, "manifest.json")),
  );
  return isObject(manifest) ? Object.keys(manifest).sort() : [];
}

/** The names of the files in a folder of the cache, none when it is missing. */
export function cacheFolderNames(cachePath: string, folder: string): string[] {
  const target = path.join(cachePath, folder);
  return existsSync(target) ? readdirSync(target).sort() : [];
}

/** The names of the lease files of the cache at `cachePath`. */
export function leaseNames(cachePath: string): string[] {
  return cacheFolderNames(cachePath, LEASES_FOLDER);
}

/**
 * The parsed lease files of the cache at `cachePath`. Like the core, it skips
 * a lease staged under another extension while a run writes it.
 */
export function readLeases(cachePath: string): ParsedJson[] {
  return leaseNames(cachePath)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const lease: unknown = JSON.parse(
        readText(path.join(cachePath, LEASES_FOLDER, name)),
      );
      if (!isParsedJson(lease)) {
        throw new Error(`Lease ${name} is not JSON`);
      }
      return lease;
    });
}

/** Writes `content` as the lease file `name` of the cache at `cachePath`. */
export function writeLease(
  cachePath: string,
  name: string,
  content: JsonValue,
): void {
  writeJson(path.join(cachePath, LEASES_FOLDER, name), content);
}

/** Writes `text` as the lease file `name` of the cache at `cachePath`. */
export function writeLeaseText(
  cachePath: string,
  name: string,
  text: string,
): void {
  const folder = path.join(cachePath, LEASES_FOLDER);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, name), text);
}

/** The path of the prune lock of the cache at `cachePath`. */
export function pruneLockPath(cachePath: string): string {
  return path.join(cachePath, LOCK_FOLDER);
}

/** What a prune lock's `owner.json` holds: its process, the token of this hold, and its heartbeat count. */
export interface LockOwner extends LeaseOwner {
  token: string;
  beat: number;
}

/**
 * Holds the prune lock of the cache at `cachePath` for `owner`, by default
 * this process at beat 0. Holding it again with a higher `beat` is a
 * heartbeat; with another `token`, another prune taking the lock.
 */
export function holdPruneLock(
  cachePath: string,
  owner: Partial<LockOwner> & { pid: number },
): void {
  writeJson(path.join(pruneLockPath(cachePath), "owner.json"), {
    ...thisProcess(),
    token: HELD_LOCK_TOKEN,
    beat: 0,
    ...owner,
  });
}

/** The token and heartbeat count in the owner of the lock at `lockFolder`, if it can be read. */
export function readLockOwner(
  lockFolder: string,
): Pick<LockOwner, "token" | "beat"> | undefined {
  try {
    const owner: unknown = JSON.parse(
      readText(path.join(lockFolder, "owner.json")),
    );
    return isObject(owner) && isString(owner.token) && isNumber(owner.beat)
      ? { token: owner.token, beat: owner.beat }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The real filesystem, except that the file at `vanishing` reads and stats
 * as removed, as when its owner deletes it between two steps of a reader.
 */
export class VanishingFileSystem extends NodeFileSystem {
  constructor(private readonly vanishing: string) {
    super();
  }

  override readFileString(file: string, encoding?: BufferEncoding) {
    return super.readFileString(this.redirect(file), encoding);
  }

  override stat(file: string) {
    return super.stat(this.redirect(file));
  }

  private redirect(file: string): string {
    return file === this.vanishing ? `${file}.removed` : file;
  }
}

/** The pid of a process of this machine that has exited. */
export function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

/** A process of this machine that runs until `stop` is called. */
export interface IdleProcess {
  pid: number;
  stop(): Promise<void>;
}

/** Starts a Node process that does nothing until it is stopped. */
export function startIdleProcess(): Promise<IdleProcess> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => {
      const pid = child.pid;
      if (pid === undefined) {
        reject(new Error("The idle process has no pid"));
        return;
      }
      resolve({
        pid,
        stop: () =>
          new Promise<void>((done) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              done();
              return;
            }
            child.once("exit", () => done());
            child.kill();
          }),
      });
    });
  });
}

/**
 * The name of a lease file of `owner`, spelled as the core spells it: the
 * hostname, the digits of the pid namespace (`0` for none), the pid and a
 * random id.
 */
export function leaseNameOf(owner: Partial<LeaseOwner> & { pid: number }) {
  const { host, namespace, pid } = { ...thisProcess(), ...owner };
  const digits = /\d+/.exec(namespace)?.[0] ?? "0";
  const safeHost = host.replace(/[^A-Za-z0-9_.-]/g, "_");
  return `${safeHost}-${digits}-${pid}-${randomUUID()}.json`;
}

function systemError(code: string): Error {
  return Object.assign(new Error(`${code}: refused by the test`), { code });
}

/**
 * The real filesystem, except that `mkdir`, `writeFile` and `rename` fail
 * with the system error `code` on every path `refuses` accepts: `EACCES` on a
 * folder this process may not write, `ENOSPC` on a full disk.
 */
export class RefusingFileSystem extends NodeFileSystem {
  constructor(
    private readonly refuses: (file: string) => boolean,
    private readonly code = "EACCES",
  ) {
    super();
  }

  override mkdir(file: string, options?: { recursive?: boolean }) {
    return this.refuses(file)
      ? Promise.reject(systemError(this.code))
      : super.mkdir(file, options);
  }

  override writeFile(file: string, data: Buffer | string) {
    return this.refuses(file)
      ? Promise.reject(systemError(this.code))
      : super.writeFile(file, data);
  }

  override rename(source: string, target: string) {
    return this.refuses(source) || this.refuses(target)
      ? Promise.reject(systemError(this.code))
      : super.rename(source, target);
  }
}

/** Whether `file` lies in the lease folder of the cache at `cachePath`. */
export function inLeaseFolder(cachePath: string): (file: string) => boolean {
  const folder = path.join(cachePath, LEASES_FOLDER);
  return (file) => file === folder || file.startsWith(`${folder}${path.sep}`);
}

/** The real filesystem, except that writing a prune lock's owner fails with `ENOSPC`. */
export class FailingOwnerFileSystem extends NodeFileSystem {
  override writeFile(file: string, data: Buffer | string) {
    if (path.basename(file).includes("owner.json")) {
      return Promise.reject(
        Object.assign(new Error("ENOSPC: no space left on device"), {
          code: "ENOSPC",
        }),
      );
    }
    return super.writeFile(file, data);
  }
}
