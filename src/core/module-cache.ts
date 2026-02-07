import * as path from 'path';
import * as os from 'os';
import * as fsNode from 'fs/promises';
import { satisfies } from 'semver';
import { IFileSystem } from '../types';
import { NodeFileSystem } from './filesystem';

export class ModuleCache {
  private manifest: Record<string, string> = {};
  private saving = false;

  constructor(
    public readonly path: string,
    private fs: IFileSystem = new NodeFileSystem(),
  ) {}

  async load(): Promise<void> {
    await this.fs.mkdir(this.path, { recursive: true });
    const manifestPath = path.join(this.path, 'manifest.json');
    if (await this.fs.exists(manifestPath)) {
      const data = await this.fs.readFileString(manifestPath);
      this.manifest = JSON.parse(data) || {};
    } else {
      this.manifest = {};
    }
  }

  async save(): Promise<void> {
    const manifestPath = path.join(this.path, 'manifest.json');
    await this.fs.writeFile(manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  getVersion(module: string): string | undefined {
    return this.manifest[module];
  }

  setVersion(module: string, version: string): void {
    this.manifest[module] = version;
    this.queueSave();
  }

  hasVersion(module: string, version: string): boolean {
    return !!(this.manifest[module] && satisfies(this.manifest[module], version));
  }

  async getFolder(module: string, noClean?: boolean, noCreate?: boolean): Promise<string> {
    const folder = path.join(this.path, module);
    if (!noClean) {
      await this.fs.rm(folder, { recursive: true, force: true });
    }
    if (!noCreate) {
      await this.fs.mkdir(folder, { recursive: true });
    }
    return folder;
  }

  static getTemp(): Promise<string> {
    return fsNode.mkdtemp(path.join(os.tmpdir(), 'ajs-'));
  }

  async transfer(source: string, module: string, version: string): Promise<string> {
    const dest = await this.getFolder(module, false, false);
    await this.copyDir(source, dest);
    await this.fs.rm(source, { recursive: true, force: true });
    this.setVersion(module, version);
    await this.save();
    return dest;
  }

  private async copyDir(source: string, dest: string): Promise<void> {
    await this.fs.mkdir(dest, { recursive: true });
    const entries = await this.fs.readdir(source);
    for (const entry of entries) {
      const srcPath = path.join(source, entry);
      const destPath = path.join(dest, entry);
      const stat = await this.fs.stat(srcPath);
      if (stat.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        await this.fs.copyFile(srcPath, destPath);
      }
    }
  }

  private queueSave(): void {
    if (this.saving) {
      return;
    }
    this.saving = true;
    setTimeout(() => {
      this.saving = false;
      void this.save();
    }, 1);
  }
}
