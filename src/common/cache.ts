import * as fs from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { satisfies } from 'semver';
import { detectIndentation } from '../cli/common';
import { existsSync, accessSync, constants } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { Logging } from '../interfaces/logging/beta';

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
   * Handle errors when creating a folder.
   *
   * @param path - Path of the folder.
   * @param err - Error object.
   */
  private async onGetFolderError(path: string, err?: Error) {
    Logging.Error(`Failed to create cache folder: ${path}`);
    Logging.Error(`Parent directory exists: ${existsSync(this.path)}`);
    if (err) {
      Logging.Error(`Error: ${err.message}`);
      Logging.Error(`Stack: ${err.stack}`);
    }
    try {
      accessSync(this.path, constants.R_OK | constants.W_OK);
      Logging.Error(`Parent directory is accessible`);
    } catch (err) {
      Logging.Error(`Parent directory is not accessible: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
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
    try {
      if (!noClean) {
        await rm(path, { recursive: true }).catch(() => {});
      }
      if (!noCreate) {
        await mkdir(path, { recursive: true });
      }
      if (!existsSync(path) && !noCreate) {
        await this.onGetFolderError(path);
      }
      return path;
    } catch (err) {
      await this.onGetFolderError(path, err as Error);
    }
    return path;
  }

  /**
   * Check whether the given module exists in this cache.
   *
   * @param module - ID of the module.
   *
   * @returns True if the module exists.
   */
  public async ensureModuleExists(module: string): Promise<boolean> {
    const modulePath = join(this.path, module);
    try {
      await fs.access(modulePath);
      return true;
    } catch {
      return false;
    }
  }

  public async verifyModule(module: string, version: string): Promise<boolean> {
    if (!this.hasVersion(module, version)) {
      return false;
    }
    return this.ensureModuleExists(module);
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
