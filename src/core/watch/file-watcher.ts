import * as path from 'path';
import { FSWatcher, watch } from 'fs';
import { IFileSystem } from '../../types';
import { FileHasher } from './file-hasher';

export type ModuleChangeListener = (moduleId: string) => void;

export class FileWatcher {
  private filesHash = new Map<string, { moduleId: string; hash: string }>();
  private listeners: ModuleChangeListener[] = [];
  private excludedDirs = new Set(['.git', 'node_modules']);
  private watchers = new Map<string, FSWatcher>();
  private watchedDirs = new Set<string>();
  private watchedDirModules = new Map<string, Set<string>>();

  constructor(
    private fs: IFileSystem,
    private hasher: FileHasher = new FileHasher(fs),
  ) {}

  onModuleChanged(listener: ModuleChangeListener): void {
    this.listeners.push(listener);
  }

  async scanModule(moduleId: string, rootDir: string, watchDirs: string[] = ['']): Promise<void> {
    for (const dir of watchDirs) {
      await this.exploreDir(moduleId, path.join(rootDir, dir));
    }
  }

  startWatching(): void {
    for (const dir of this.watchedDirs) {
      if (this.watchers.has(dir)) {
        continue;
      }
      try {
        const watcher = watch(dir, (event, filename) => {
          if (!filename || (event !== 'change' && event !== 'rename')) {
            return;
          }
          const fileName = Buffer.isBuffer(filename) ? filename.toString() : filename;
          const filePath = path.join(dir, fileName);
          void this.handleFileChange(filePath);
        });
        watcher.on('error', (err) => {
          console.error(`FileWatcher error for ${dir}:`, err);
        });
        this.watchers.set(dir, watcher);
      } catch (err) {
        console.error(`Failed to watch directory ${dir}:`, err);
      }
    }
  }

  stopWatching(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }

  async handleFileChange(filePath: string): Promise<void> {
    if (this.isExcludedPath(filePath)) {
      return;
    }

    const entry = this.filesHash.get(filePath);

    if (!(await this.fs.exists(filePath))) {
      if (entry) {
        this.filesHash.delete(filePath);
        this.notifyModuleChange(entry.moduleId);
      }
      return;
    }

    const stat = await this.fs.stat(filePath);
    if (stat.isDirectory()) {
      return;
    }

    const newHash = await this.hasher.hashFile(filePath);
    if (!entry) {
      const moduleId = this.getModuleIdForPath(filePath);
      if (!moduleId) {
        return;
      }
      this.filesHash.set(filePath, { moduleId, hash: newHash });
      this.notifyModuleChange(moduleId);
      return;
    }

    if (newHash !== entry.hash) {
      this.filesHash.set(filePath, { moduleId: entry.moduleId, hash: newHash });
      this.notifyModuleChange(entry.moduleId);
    }
  }

  private async exploreDir(moduleId: string, dirPath: string): Promise<void> {
    this.trackWatchedDir(dirPath, moduleId);
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
        this.filesHash.set(fullPath, { moduleId, hash });
      }
    }
  }

  private trackWatchedDir(dirPath: string, moduleId: string): void {
    this.watchedDirs.add(dirPath);
    const existing = this.watchedDirModules.get(dirPath);
    if (existing) {
      existing.add(moduleId);
    } else {
      this.watchedDirModules.set(dirPath, new Set([moduleId]));
    }
  }

  private getModuleIdForPath(filePath: string): string | undefined {
    let current = path.dirname(path.resolve(filePath));
    while (true) {
      const entry = this.watchedDirModules.get(current);
      if (entry && entry.size > 0) {
        return entry.values().next().value;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return undefined;
      }
      current = parent;
    }
  }

  private notifyModuleChange(moduleId: string): void {
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
