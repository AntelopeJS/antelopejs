import * as fs from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { satisfies } from 'semver';
import { detectIndentation } from '../cli/common';
import { mkdir, rm } from 'fs/promises';

/**
 * Module Cache management
 */
export class ModuleCache {
  private manifest?: { [module: string]: string };

  /**
   * Constructs a new Module Cache with the given folder name.
   *
   * @param path - Name of the folder to manage.
   */
  constructor(public readonly path: string) {}

  /**
   * Load manifest information from disk.
   */
  public async load() {
    await fs.mkdir(this.path, { recursive: true });
    try {
      const data = await fs.readFile(join(this.path, 'manifest.json'));
      this.manifest = JSON.parse(data.toString()) || {};
    } catch {
      this.manifest = {};
    }
  }

  private saving?: boolean;
  /**
   * Mark the manifest as modified and queue a write to disk.
   */
  private queueSave() {
    if (this.saving) {
      return;
    }
    this.saving = true;
    setTimeout(async () => {
      this.saving = false;
      const manifestPath = join(this.path, 'manifest.json');
      const indentation = await detectIndentation(manifestPath);
      fs.writeFile(manifestPath, JSON.stringify(this.manifest, null, indentation));
    }, 1);
  }

  /**
   * Get the version of a module installed in this cache.
   *
   * @param module - ID of the module.
   *
   * @returns The version of the cached module or undefined.
   */
  public getVersion(module: string): string | undefined {
    return this.manifest![module];
  }

  /**
   * Set the version of a module installed in this cache.
   *
   * @param module - ID of the module.
   * @param version - new version.
   */
  public setVersion(module: string, version: string) {
    this.manifest![module] = version;
    this.queueSave();
  }

  /**
   * Check whether the installed version of a module satisfies the given SemVer constraint.
   *
   * @param module - ID of the module.
   * @param version - Semantic Versioning constraint.
   *
   * @returns True if the installed version is sufficient.
   */
  public hasVersion(module: string, version: string): boolean {
    return !!(this.manifest![module] && satisfies(this.manifest![module], version));
  }

  /**
   * Get path of a module in this cache, clearing and creating it if not specified.
   *
   * @param module - ID of the module.
   * @param noClean - Don't remove the existing folder.
   * @param noCreate - Don't create a new folder.
   *
   * @returns The absolute path to the cache folder for this module.
   */
  public async getFolder(module: string, noClean?: boolean, noCreate?: boolean): Promise<string> {
    const path = join(this.path, module);
    if (!noClean) {
      await rm(path, { recursive: true }).catch(() => {});
    }
    if (!noCreate) {
      await mkdir(path, { recursive: true });
    }
    return path;
  }

  /**
   * Get a temporary folder.
   *
   * @returns The absolute path to the temporary folder.
   */
  public static getTemp(): Promise<string> {
    return fs.mkdtemp(join(tmpdir(), 'ajs-'));
  }

  /**
   * Transfer an existing folder to the cache folder of the given module.
   *
   * @param source - Source folder.
   * @param module - ID of the module.
   *
   * @returns The absolute path to the final folder.
   */
  public async transfer(source: string, module: string, version: string): Promise<string> {
    const dest = await this.getFolder(module, false, false);
    await fs.cp(source, dest, { recursive: true });
    await fs.rm(source, { recursive: true });
    this.setVersion(module, version);
    return dest;
  }
}
