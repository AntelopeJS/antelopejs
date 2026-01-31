import * as path from 'path';
import { IFileSystem } from '../../types';
import { FileHasher } from './file-hasher';

export type ModuleChangeListener = (moduleId: string) => void;

export class FileWatcher {
  private filesHash = new Map<string, { moduleId: string; hash: string }>();
  private listeners: ModuleChangeListener[] = [];
  private excludedDirs = new Set(['.git', 'node_modules']);

  constructor(private fs: IFileSystem, private hasher: FileHasher = new FileHasher(fs)) {}

  onModuleChanged(listener: ModuleChangeListener): void {
    this.listeners.push(listener);
  }

  async scanModule(moduleId: string, rootDir: string, watchDirs: string[] = ['']): Promise<void> {
    for (const dir of watchDirs) {
      await this.exploreDir(moduleId, path.join(rootDir, dir));
    }
  }

  async handleFileChange(filePath: string): Promise<void> {
    if (!(await this.fs.exists(filePath))) {
      return;
    }

    const stat = await this.fs.stat(filePath);
    if (stat.isDirectory()) {
      return;
    }

    const entry = this.filesHash.get(filePath);
    if (!entry) {
      return;
    }

    const newHash = await this.hasher.hashFile(filePath);
    if (newHash === entry.hash) {
      return;
    }

    this.filesHash.set(filePath, { moduleId: entry.moduleId, hash: newHash });
    for (const listener of this.listeners) {
      listener(entry.moduleId);
    }
  }

  private async exploreDir(moduleId: string, dirPath: string): Promise<void> {
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
}
