import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

import sinon from "sinon";

import type { IFileSystem } from "../../src/types";

type WatchEvent = "rename" | "change";
type WatchListener = fs.WatchListener<string>;

function errno(code: string, target: string): Error {
  return Object.assign(new Error(`${code}: ${target}`), { code });
}

function isInside(candidate: string, folder: string): boolean {
  return candidate === folder || candidate.startsWith(`${folder}${path.sep}`);
}

/** An open `fs.watch` watcher, bound to the directory it was opened on. */
export class FakeWatcher extends EventEmitter {
  closed = false;

  constructor(
    readonly directoryId: number,
    readonly listener: WatchListener,
  ) {
    super();
  }

  close(): void {
    this.closed = true;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

/**
 * A virtual file system whose directories have identities, like inodes, and
 * a fake `fs.watch`. A watcher follows its directory when it is moved, goes
 * silent when it is deleted, and receives `rename` or `change` events for
 * the entries of its directory, each delivered in a later macrotask.
 */
export class FolderWorld implements IFileSystem {
  private directories = new Map<string, number>();
  private files = new Map<string, string>();
  private nextId = 1;
  private watchers: FakeWatcher[] = [];
  private failing = new Set<string>();
  private pending = 0;
  private delivered = 0;

  constructor() {
    this.directories.set(path.parse(path.resolve("/")).root, this.nextId++);
  }

  /** Makes the next `fs.watch` of `directory` throw `EPERM`, once. */
  failNextWatch(directory: string): void {
    this.failing.add(directory);
  }

  /** Emits an `error` on every open watcher of `directory`. */
  failWatchers(directory: string): void {
    const id = this.directories.get(directory);
    for (const watcher of this.watchers) {
      if (!watcher.closed && watcher.directoryId === id) {
        watcher.emit("error", new Error(`EIO: ${directory}`));
      }
    }
  }

  /** The `fs.watch` replacement. */
  watch(directory: string, listener: WatchListener = () => {}): FakeWatcher {
    if (this.failing.delete(directory)) {
      throw errno("EPERM", directory);
    }
    const id = this.directories.get(directory);
    if (id === undefined) {
      throw errno("ENOENT", directory);
    }
    const watcher = new FakeWatcher(id, listener);
    this.watchers.push(watcher);
    return watcher;
  }

  /** Replaces `fs.watch` until the returned function is called. */
  installWatch(): () => void {
    const stub = sinon.stub(fs, "watch");
    stub.callsFake((target, listener) => this.watch(String(target), listener));
    return () => stub.restore();
  }

  /** The directory of each open watcher, `gone` for one whose directory was deleted. */
  openWatcherDirectories(): string[] {
    const byId = new Map(
      [...this.directories].map(([directory, id]) => [id, directory]),
    );
    return this.watchers
      .filter((watcher) => !watcher.closed)
      .map((watcher) => byId.get(watcher.directoryId) ?? "gone")
      .sort();
  }

  /** The existing directories at or under `folder`, sorted. */
  directoriesUnder(folder: string): string[] {
    return [...this.directories.keys()]
      .filter((directory) => isInside(directory, folder))
      .sort();
  }

  /** Whether events are queued, and how many were delivered so far. */
  activity(): string {
    return `${this.pending}:${this.delivered}`;
  }

  isQuiet(): boolean {
    return this.pending === 0;
  }

  /** Creates `directory` and its missing ancestors. */
  createDirectory(directory: string): void {
    const missing: string[] = [];
    for (let at = directory; !this.directories.has(at); at = path.dirname(at)) {
      missing.push(at);
    }
    for (const created of missing.reverse()) {
      this.directories.set(created, this.nextId++);
      this.notify(path.dirname(created), "rename", path.basename(created));
    }
  }

  /** Deletes `target` and everything under it, deepest entries first. */
  removeTree(target: string): void {
    const doomedFiles = [...this.files.keys()].filter((file) =>
      isInside(file, target),
    );
    for (const file of doomedFiles) {
      this.files.delete(file);
      this.notify(path.dirname(file), "rename", path.basename(file));
    }
    const doomed = [...this.directories.keys()]
      .filter((directory) => isInside(directory, target))
      .sort((left, right) => right.length - left.length);
    for (const directory of doomed) {
      this.notify(directory, "rename", path.basename(directory));
      this.notify(path.dirname(directory), "rename", path.basename(directory));
      this.directories.delete(directory);
    }
  }

  /** Moves the directory `from` and its content to `to`, keeping their identities. */
  moveTree(from: string, to: string): void {
    this.notify(from, "rename", path.basename(from));
    this.notify(path.dirname(from), "rename", path.basename(from));
    const rebase = (entry: string) => path.join(to, path.relative(from, entry));
    const moved = [...this.directories].filter(([directory]) =>
      isInside(directory, from),
    );
    const movedFiles = [...this.files].filter(([file]) => isInside(file, from));
    for (const [directory] of moved) {
      this.directories.delete(directory);
    }
    for (const [file] of movedFiles) {
      this.files.delete(file);
    }
    for (const [directory, id] of moved) {
      this.directories.set(rebase(directory), id);
    }
    for (const [file, content] of movedFiles) {
      this.files.set(rebase(file), content);
    }
    this.notify(path.dirname(to), "rename", path.basename(to));
  }

  hasDirectory(directory: string): boolean {
    return this.directories.has(directory);
  }

  private notify(directory: string, event: WatchEvent, filename: string): void {
    const id = this.directories.get(directory);
    for (const watcher of this.watchers) {
      if (watcher.closed || watcher.directoryId !== id) {
        continue;
      }
      this.pending++;
      setImmediate(() => {
        this.pending--;
        if (!watcher.closed) {
          this.delivered++;
          watcher.listener(event, filename);
        }
      });
    }
  }

  async readFile(filePath: string): Promise<Buffer> {
    const content = this.files.get(filePath);
    if (content === undefined) {
      throw errno("ENOENT", filePath);
    }
    return Buffer.from(content);
  }

  async readFileString(filePath: string): Promise<string> {
    return (await this.readFile(filePath)).toString("utf-8");
  }

  /** Writes a file now, in an existing directory. */
  putFile(filePath: string, data: Buffer | string): void {
    const directory = path.dirname(filePath);
    if (!this.directories.has(directory)) {
      throw errno("ENOENT", directory);
    }
    const created = !this.files.has(filePath);
    this.files.set(filePath, data.toString());
    this.notify(
      directory,
      created ? "rename" : "change",
      path.basename(filePath),
    );
  }

  async writeFile(filePath: string, data: Buffer | string): Promise<void> {
    this.putFile(filePath, data);
  }

  async readdir(directory: string): Promise<string[]> {
    if (!this.directories.has(directory)) {
      throw errno(this.files.has(directory) ? "ENOTDIR" : "ENOENT", directory);
    }
    return [...this.directories.keys(), ...this.files.keys()]
      .filter(
        (entry) => path.dirname(entry) === directory && entry !== directory,
      )
      .map((entry) => path.basename(entry));
  }

  async stat(target: string): Promise<fs.Stats> {
    const isDirectory = this.directories.has(target);
    if (!isDirectory && !this.files.has(target)) {
      throw errno("ENOENT", target);
    }
    const stats = sinon.createStubInstance(fs.Stats);
    stats.isDirectory.returns(isDirectory);
    stats.isFile.returns(!isDirectory);
    return stats;
  }

  async mkdir(directory: string): Promise<void> {
    this.createDirectory(directory);
  }

  async rm(target: string): Promise<void> {
    this.removeTree(target);
  }

  async exists(target: string): Promise<boolean> {
    return this.directories.has(target) || this.files.has(target);
  }

  async access(target: string): Promise<void> {
    if (!(await this.exists(target))) {
      throw errno("ENOENT", target);
    }
  }

  async copyFile(source: string, destination: string): Promise<void> {
    await this.writeFile(destination, await this.readFile(source));
  }

  async rename(from: string, to: string): Promise<void> {
    this.moveTree(from, to);
  }
}
