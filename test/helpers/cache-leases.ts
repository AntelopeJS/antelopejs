import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { NodeFileSystem } from "../../src/core/filesystem";
import { isObject, isParsedJson, type ParsedJson } from "../../src/utils";
import type { JsonValue } from "./json";
import { readText, writeJson } from "./temp";

const LEASES_FOLDER = ".leases";
const LOCK_FOLDER = ".prune.lock";
const OLDER_THAN_STALE_MS = 120_000;

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

/** The parsed lease files of the cache at `cachePath`. */
export function readLeases(cachePath: string): ParsedJson[] {
  return leaseNames(cachePath).map((name) => {
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

/**
 * Holds the prune lock of the cache at `cachePath` for the process `pid` of
 * this machine. An `aged` lock is dated two minutes back.
 */
export function holdPruneLock(
  cachePath: string,
  pid: number,
  aged = false,
): void {
  const lock = pruneLockPath(cachePath);
  writeJson(path.join(lock, "owner.json"), { host: os.hostname(), pid });
  if (aged) {
    const past = new Date(Date.now() - OLDER_THAN_STALE_MS);
    utimesSync(lock, past, past);
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
            child.once("exit", () => done());
            child.kill();
          }),
      });
    });
  });
}

/** This machine's hostname as a lease file name spells it. */
export function hostnameInLeaseName(): string {
  return os.hostname().replace(/[^A-Za-z0-9_.-]/g, "_");
}

function systemError(code: string): Error {
  return Object.assign(new Error(`${code}: refused by the test`), { code });
}

/**
 * The real filesystem, except that `mkdir`, `writeFile` and `rename` fail
 * with `EACCES` on every path `refuses` accepts, as on a folder this process
 * may not write.
 */
export class RefusingFileSystem extends NodeFileSystem {
  constructor(private readonly refuses: (file: string) => boolean) {
    super();
  }

  override mkdir(file: string, options?: { recursive?: boolean }) {
    return this.refuses(file)
      ? Promise.reject(systemError("EACCES"))
      : super.mkdir(file, options);
  }

  override writeFile(file: string, data: Buffer | string) {
    return this.refuses(file)
      ? Promise.reject(systemError("EACCES"))
      : super.writeFile(file, data);
  }

  override rename(source: string, target: string) {
    return this.refuses(source) || this.refuses(target)
      ? Promise.reject(systemError("EACCES"))
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
    if (path.basename(file) === "owner.json") {
      return Promise.reject(
        Object.assign(new Error("ENOSPC: no space left on device"), {
          code: "ENOSPC",
        }),
      );
    }
    return super.writeFile(file, data);
  }
}
