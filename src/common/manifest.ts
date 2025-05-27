import path from 'path';
import { ModuleSource } from './downloader';
import { lstat, readdir } from 'fs/promises';
import { Logging } from '../interfaces/logging/beta';

export type ModuleImport = string | { name: string; git?: string; skipInstall?: boolean };

export function mapModuleImport(moduleImport: ModuleImport): string {
  return typeof moduleImport === 'object' ? moduleImport.name : moduleImport;
}

/**
 * Fields used by AntelopeJS from the package.json file of modules.
 */
export interface ModulePackageJson {
  name: string;
  version: string;
  description?: string;
  author?: string | Array<string>;

  antelopeJs?: {
    imports: ModuleImport[];
    importsOptional: ModuleImport[];

    exports?: string[];
    exportsPath?: string;

    baseUrl?: string;
    paths?: Record<string, string[]>;

    moduleAliases?: Record<string, string>;

    config?: Record<string, any>;
  };

  _moduleAliases?: Record<string, string>;
}

export class ModuleManifest {
  public readonly name: string;
  public version: string;
  public readonly folder: string;

  public readonly baseUrl: string;
  public readonly paths: {
    key: string;
    values: string[];
  }[] = [];

  private manifest: ModulePackageJson;
  public exportsPath: string;

  public exports: Record<string, string> = {};
  public imports: string[] = [];

  public srcAliases?: Array<{ alias: string; replace: string }>;

  private static readManifest(folder: string) {
    try {
      return require(path.join(folder, 'package.json'));
    } catch {
      Logging.Error(`Missing package.json in '${folder}'`);
      return {
        name: folder,
        version: '0.0.0',
      };
    }
  }

  constructor(
    folder: string,
    public readonly source: ModuleSource,
  ) {
    this.folder = path.resolve(folder);
    this.manifest = ModuleManifest.readManifest(this.folder);
    this.name = this.manifest.name;
    this.version = this.manifest.version;
    this.exportsPath = path.join(this.folder, this.manifest.antelopeJs?.exportsPath || 'interfaces');
    this.imports = this.manifest.antelopeJs?.imports?.map(mapModuleImport) ?? [];

    this.baseUrl = path.join(this.folder, this.manifest.antelopeJs?.baseUrl ?? '');
    if (this.manifest.antelopeJs?.paths) {
      for (const [key, values] of Object.entries(this.manifest.antelopeJs?.paths)) {
        this.paths.push({
          key: key.replace(/\*$/, ''),
          values: values.map((value) => path.join(this.baseUrl, value.replace(/\*$/, ''))),
        });
      }
    }

    if (this.manifest._moduleAliases) {
      this.srcAliases = Object.entries(this.manifest._moduleAliases).map(([alias, replace]) => ({
        alias,
        replace: path.join(this.folder, replace),
      }));
    }
    if (this.manifest.antelopeJs?.moduleAliases) {
      this.srcAliases = [
        ...(this.srcAliases || []),
        ...Object.entries(this.manifest.antelopeJs.moduleAliases).map(([alias, replace]) => ({
          alias,
          replace: path.join(this.folder, replace),
        })),
      ];
    }
  }

  public async loadExports() {
    this.exports = {};
    const addIfFolder = async (name: string, ifFolder: string) => {
      for (const version of await readdir(ifFolder)) {
        const versionName = version.match(/^([^.]+)(?:\.js)?$/);
        if (versionName) {
          this.exports[`${name}@${versionName[1]}`] = path.join(ifFolder, versionName[1]);
          this.imports.push(`${name}@${versionName[1]}`);
        }
      }
    };
    if (this.manifest.antelopeJs?.exports) {
      for (const nameVersion of this.manifest.antelopeJs.exports) {
        const match = nameVersion.match(/^([^@]*)(?:@(.*))?$/);
        if (match) {
          if (match[2]) {
            this.exports[nameVersion] = path.join(this.exportsPath, match[1], match[2]);
            this.imports.push(nameVersion);
          } else {
            await addIfFolder(match[1], path.join(this.exportsPath, match[1]));
          }
        }
      }
    } else if (
      await lstat(this.exportsPath)
        .then((s) => s.isDirectory())
        .catch(() => false)
    ) {
      for (const name of await readdir(this.exportsPath)) {
        const ifFolder = path.join(this.exportsPath, name);
        if ((await lstat(ifFolder)).isDirectory()) {
          await addIfFolder(name, ifFolder);
        }
      }
    }
  }

  public async reload() {
    this.manifest = ModuleManifest.readManifest(this.folder);
    this.version = this.manifest.version;
    this.exportsPath = path.join(this.folder, this.manifest.antelopeJs?.exportsPath || 'interfaces');
    this.imports = this.manifest.antelopeJs?.imports.map(mapModuleImport) ?? [];
    await this.loadExports();
  }
}
