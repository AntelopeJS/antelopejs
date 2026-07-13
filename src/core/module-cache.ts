import * as fsNode from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { satisfies } from "semver";
import type { IFileSystem } from "../types";
import { NodeFileSystem } from "./filesystem";

export class ModuleCache {
  private manifest: Record<string, string> = {};
  private pendingSave: Promise<void> = Promise.resolve();

  constructor(
    public readonly path: string,
    private fs: IFileSystem = new NodeFileSystem(),
  ) {}

  async load(): Promise<void> {
    await this.fs.mkdir(this.path, { recursive: true });
    const manifestPath = path.join(this.path, "manifest.json");
    this.manifest = {};
    if (await this.fs.exists(manifestPath)) {
      try {
        const data = await this.fs.readFileString(manifestPath);
        this.manifest = JSON.parse(data) || {};
      } catch {
        this.manifest = {};
      }
    }
  }

  save(): Promise<void> {
    const manifestPath = path.join(this.path, "manifest.json");
    this.pendingSave = this.pendingSave.then(() =>
      this.fs.writeFile(manifestPath, JSON.stringify(this.manifest, null, 2)),
    );
    return this.pendingSave;
  }

  getVersion(module: string): string | undefined {
    return this.manifest[module];
  }

  setVersion(module: string, version: string): void {
    this.manifest[module] = version;
  }

  hasVersion(module: string, version: string): boolean {
    return !!(
      this.manifest[module] && satisfies(this.manifest[module], version)
    );
  }

  async getFolder(
    module: string,
    noClean?: boolean,
    noCreate?: boolean,
  ): Promise<string> {
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
    return fsNode.mkdtemp(path.join(os.tmpdir(), "ajs-"));
  }

  async transfer(source: string, module: string): Promise<string> {
    const dest = await this.getFolder(module, false, false);
    await this.copyDir(source, dest);
    await this.fs.rm(source, { recursive: true, force: true });
    return dest;
  }

  async commitVersion(module: string, version: string): Promise<void> {
    this.setVersion(module, version);
    await this.save();
  }

  async clearVersion(module: string): Promise<void> {
    delete this.manifest[module];
    await this.save();
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
}
