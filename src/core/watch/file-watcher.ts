import { createHash } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import * as path from "node:path";
import type { IFileSystem } from "../../types";
import { FileHasher } from "./file-hasher";

export type ModuleChangeListener = (moduleId: string) => void;
export type FileChangeListener = (filePath: string) => void;

const EXCLUDED_WATCH_DIRS = [".git", "node_modules"];

export class FileWatcher {
  private filesHash = new Map<string, { moduleId: string; hash: string }>();
  private moduleFiles = new Map<string, Set<string>>();
  private listeners: ModuleChangeListener[] = [];
  private excludedDirs = new Set(EXCLUDED_WATCH_DIRS);
  private watchers = new Map<string, FSWatcher>();
  private watchedDirs = new Set<string>();
  private dirModules = new Map<string, string>();
  private watchedFiles = new Map<
    string,
    { hash: string; listeners: FileChangeListener[] }
  >();
  private changeChains = new Map<string, Promise<void>>();
  private stopped = false;

  constructor(
    private fs: IFileSystem,
    private hasher: FileHasher = new FileHasher(fs),
  ) {}

  onModuleChanged(listener: ModuleChangeListener): void {
    this.listeners.push(listener);
  }

  async scanModule(
    moduleId: string,
    rootDir: string,
    watchDirs: string[] = [""],
  ): Promise<void> {
    for (const dir of watchDirs) {
      await this.exploreDir(moduleId, path.join(rootDir, dir));
    }
  }

  async watchFile(
    filePath: string,
    listener: FileChangeListener,
  ): Promise<void> {
    const resolved = path.resolve(filePath);
    const dir = path.dirname(resolved);

    const existing = this.watchedFiles.get(resolved);
    if (existing) {
      existing.listeners.push(listener);
      return;
    }

    const hash = await this.hasher.hashFile(resolved);
    this.watchedFiles.set(resolved, { hash, listeners: [listener] });
    this.watchedDirs.add(dir);
  }

  startWatching(): void {
    for (const dir of this.watchedDirs) {
      if (this.watchers.has(dir)) {
        continue;
      }
      try {
        const watcher = watch(dir, (event, filename) => {
          if (!filename || (event !== "change" && event !== "rename")) {
            return;
          }
          const fileName = Buffer.isBuffer(filename)
            ? filename.toString()
            : filename;
          const filePath = path.join(dir, fileName);
          this.enqueueChange(dir, filePath);
        });
        watcher.on("error", (err) => {
          console.error(`FileWatcher error for ${dir}:`, err);
        });
        this.watchers.set(dir, watcher);
      } catch (err) {
        console.error(`Failed to watch directory ${dir}:`, err);
      }
    }
  }

  stopWatching(): void {
    this.stopped = true;
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.changeChains.clear();
  }

  private enqueueChange(dir: string, filePath: string): void {
    const previous = this.changeChains.get(dir) ?? Promise.resolve();
    const next = previous
      .then(() => this.handleFileChange(filePath))
      .catch((err) => {
        console.error(`FileWatcher error handling ${filePath}:`, err);
      });
    this.changeChains.set(dir, next);
  }

  private setFileEntry(filePath: string, moduleId: string, hash: string): void {
    const existing = this.filesHash.get(filePath);
    if (existing && existing.moduleId !== moduleId) {
      this.moduleFiles.get(existing.moduleId)?.delete(filePath);
    }
    this.filesHash.set(filePath, { moduleId, hash });
    let files = this.moduleFiles.get(moduleId);
    if (!files) {
      files = new Set();
      this.moduleFiles.set(moduleId, files);
    }
    files.add(filePath);
  }

  private deleteFileEntry(filePath: string): void {
    const existing = this.filesHash.get(filePath);
    if (!existing) {
      return;
    }
    this.filesHash.delete(filePath);
    this.moduleFiles.get(existing.moduleId)?.delete(filePath);
  }

  async handleFileChange(filePath: string): Promise<void> {
    if (this.isExcludedPath(filePath)) {
      return;
    }

    const resolved = path.resolve(filePath);
    const watchedFile = this.watchedFiles.get(resolved);
    if (watchedFile) {
      await this.handleWatchedFileChange(resolved, watchedFile);
      return;
    }

    const entry = this.filesHash.get(filePath);
    if (!entry) {
      await this.handleNewPath(filePath);
      return;
    }

    if (!(await this.fs.exists(filePath))) {
      this.deleteFileEntry(filePath);
      this.notifyModuleChange(entry.moduleId);
      return;
    }

    const stat = await this.fs.stat(filePath);
    if (stat.isDirectory()) {
      return;
    }

    const newHash = await this.hasher.hashFile(filePath);
    if (newHash !== entry.hash) {
      this.setFileEntry(filePath, entry.moduleId, newHash);
      this.notifyModuleChange(entry.moduleId);
    }
  }

  private async handleWatchedFileChange(
    filePath: string,
    entry: { hash: string; listeners: FileChangeListener[] },
  ): Promise<void> {
    if (!(await this.fs.exists(filePath))) {
      console.warn(`Watched file deleted: ${filePath}`);
      return;
    }

    const newHash = await this.hasher.hashFile(filePath);
    if (newHash === entry.hash) {
      return;
    }

    entry.hash = newHash;
    if (this.stopped) {
      return;
    }
    for (const listener of entry.listeners) {
      listener(filePath);
    }
  }

  private async handleNewPath(filePath: string): Promise<void> {
    if (!(await this.fs.exists(filePath))) {
      this.handleRemovedDir(filePath);
      return;
    }
    const moduleId = this.dirModules.get(path.dirname(filePath));
    if (!moduleId) {
      return;
    }
    const stat = await this.fs.stat(filePath);
    if (stat.isDirectory()) {
      if (this.watchedDirs.has(filePath)) {
        return;
      }
      await this.exploreDir(moduleId, filePath);
      this.startWatching();
      this.notifyModuleChange(moduleId);
      return;
    }

    const hash = await this.hasher.hashFile(filePath);
    if (!(await this.fs.exists(filePath))) {
      return;
    }
    this.setFileEntry(filePath, moduleId, hash);
    this.notifyModuleChange(moduleId);
  }

  private handleRemovedDir(dirPath: string): void {
    if (!this.watchedDirs.has(dirPath)) {
      return;
    }
    const moduleId = this.dirModules.get(dirPath);
    this.pruneDir(dirPath);
    if (moduleId) {
      this.notifyModuleChange(moduleId);
    }
  }

  private pruneDir(dirPath: string): void {
    const prefix = `${dirPath}${path.sep}`;
    for (const dir of this.watchedDirs) {
      if (dir !== dirPath && !dir.startsWith(prefix)) {
        continue;
      }
      this.watchedDirs.delete(dir);
      this.dirModules.delete(dir);
      this.changeChains.delete(dir);
      const watcher = this.watchers.get(dir);
      if (watcher) {
        watcher.close();
        this.watchers.delete(dir);
      }
    }
    for (const filePath of this.filesHash.keys()) {
      if (filePath.startsWith(prefix)) {
        this.deleteFileEntry(filePath);
      }
    }
  }

  getModuleSignature(moduleId: string): string {
    const files = this.moduleFiles.get(moduleId);
    const entries: string[] = [];
    if (files) {
      for (const filePath of files) {
        const entry = this.filesHash.get(filePath);
        if (entry) {
          entries.push(`${filePath}\0${entry.hash}`);
        }
      }
    }
    entries.sort();
    return createHash("sha256").update(entries.join("\n")).digest("hex");
  }

  private async exploreDir(moduleId: string, dirPath: string): Promise<void> {
    this.watchedDirs.add(dirPath);
    this.dirModules.set(dirPath, moduleId);
    const entries = await this.fs.readdir(dirPath);
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const stat = await this.fs.stat(fullPath);
      if (stat.isDirectory()) {
        if (this.excludedDirs.has(entry)) {
          continue;
        }
        await this.exploreDir(moduleId, fullPath);
      } else {
        const hash = await this.hasher.hashFile(fullPath);
        this.setFileEntry(fullPath, moduleId, hash);
      }
    }
  }

  private notifyModuleChange(moduleId: string): void {
    if (this.stopped) {
      return;
    }
    for (const listener of this.listeners) {
      listener(moduleId);
    }
  }

  private isExcludedPath(filePath: string): boolean {
    const normalized = path.normalize(filePath);
    const parts = normalized.split(path.sep);
    return parts.some((part) => this.excludedDirs.has(part));
  }
}
