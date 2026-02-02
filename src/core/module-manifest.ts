import * as path from 'path';
import { IFileSystem, ModuleSource } from '../types';
import { NodeFileSystem } from './filesystem';

export type ModuleImport = string | { name: string; git?: string; skipInstall?: boolean };

export function mapModuleImport(moduleImport: ModuleImport): string {
  return typeof moduleImport === 'object' ? moduleImport.name : moduleImport;
}

export interface ModulePackageJson {
  name: string;
  version: string;
  description?: string;
  author?: string | string[];

  antelopeJs?: {
    imports?: ModuleImport[];
    importsOptional?: ModuleImport[];

    exports?: string[];
    exportsPath?: string;

    baseUrl?: string;
    paths?: Record<string, string[]>;

    moduleAliases?: Record<string, string>;

    defaultConfig?: Record<string, unknown>;
  };

  _moduleAliases?: Record<string, string>;
}

export class ModuleManifest {
  public version: string;
  public readonly folder: string;
  public readonly main: string;

  public readonly baseUrl: string;
  public readonly paths: { key: string; values: string[] }[] = [];

  public manifest: ModulePackageJson;
  public exportsPath: string;

  public exports: Record<string, string> = {};
  public imports: string[] = [];

  public srcAliases?: Array<{ alias: string; replace: string }>;

  private constructor(
    folder: string,
    public readonly source: ModuleSource,
    public readonly name: string,
    manifest: ModulePackageJson,
    private fs: IFileSystem,
  ) {
    this.folder = path.resolve(folder);
    this.manifest = manifest;
    this.version = this.manifest.version;
    this.exportsPath = path.join(this.folder, this.manifest.antelopeJs?.exportsPath || 'interfaces');
    this.imports = this.manifest.antelopeJs?.imports?.map(mapModuleImport) ?? [];

    const mainCandidate = (source as { main?: string }).main;
    this.main = typeof mainCandidate === 'string' ? path.join(this.folder, mainCandidate) : this.folder;

    this.baseUrl = path.join(this.folder, this.manifest.antelopeJs?.baseUrl ?? '');
    if (this.manifest.antelopeJs?.paths) {
      for (const [key, values] of Object.entries(this.manifest.antelopeJs.paths)) {
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

  static async create(
    folder: string,
    source: ModuleSource,
    name: string,
    fs: IFileSystem = new NodeFileSystem(),
  ): Promise<ModuleManifest> {
    const manifest = await ModuleManifest.readManifest(folder, fs);
    return new ModuleManifest(folder, source, name, manifest, fs);
  }

  static async readManifest(folder: string, fs: IFileSystem = new NodeFileSystem()): Promise<ModulePackageJson> {
    const packageJsonPath = path.join(folder, 'package.json');
    const dedicatedJsonPath = path.join(folder, 'antelope.module.json');

    if (!(await fs.exists(packageJsonPath))) {
      throw new Error(`Missing package.json in '${folder}'`);
    }

    const packageJson = JSON.parse(await fs.readFileString(packageJsonPath)) as ModulePackageJson;

    if (await fs.exists(dedicatedJsonPath)) {
      const dedicatedJson = JSON.parse(await fs.readFileString(dedicatedJsonPath)) as ModulePackageJson['antelopeJs'];
      return {
        ...packageJson,
        antelopeJs: dedicatedJson,
      };
    }

    return packageJson;
  }

  async loadExports(): Promise<void> {
    this.exports = {};
    const addIfFolder = async (name: string, ifFolder: string) => {
      if (!(await this.isDirectory(ifFolder))) return;
      for (const version of await this.fs.readdir(ifFolder)) {
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
    } else if (await this.isDirectory(this.exportsPath)) {
      for (const name of await this.fs.readdir(this.exportsPath)) {
        const ifFolder = path.join(this.exportsPath, name);
        if (await this.isDirectory(ifFolder)) {
          await addIfFolder(name, ifFolder);
        }
      }
    }
  }

  async reload(): Promise<void> {
    this.manifest = await ModuleManifest.readManifest(this.folder, this.fs);
    this.version = this.manifest.version;
    this.exportsPath = path.join(this.folder, this.manifest.antelopeJs?.exportsPath || 'interfaces');
    this.imports = this.manifest.antelopeJs?.imports?.map(mapModuleImport) ?? [];
    await this.loadExports();
  }

  private async isDirectory(filePath: string): Promise<boolean> {
    try {
      const stat = await this.fs.stat(filePath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}
