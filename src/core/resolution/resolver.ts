import * as path from 'path';
import { ModuleManifest } from '../module-manifest';
import { PathMapper } from './path-mapper';

export interface ModuleRef {
  id: string;
  manifest: ModuleManifest;
}

export class Resolver {
  public readonly moduleByFolder = new Map<string, ModuleRef>();
  public readonly moduleAssociations = new Map<string, Map<string, ModuleRef | null>>();
  public readonly modulesById = new Map<string, ModuleRef>();

  constructor(private pathMapper: PathMapper) {}

  resolve(request: string, parent?: { filename?: string }): string | undefined {
    let matchingFolder = '';
    let matchingModule: ModuleRef | undefined;

    if (parent?.filename) {
      for (const [folder, module] of this.moduleByFolder) {
        if (parent.filename.startsWith(folder) && folder.length > matchingFolder.length) {
          matchingFolder = folder;
          matchingModule = module;
        }
      }
    }

    if (matchingModule) {
      const manifest = matchingModule.manifest;

      if (request.startsWith('@ajs.local/')) {
        return path.join(manifest.exportsPath, request.substring(11));
      }

      if (request.startsWith('@ajs/')) {
        const match = request.match(/^@ajs\/([^\/]+)\/([^\/]+)/);
        if (match) {
          const [, name, version] = match;
          const associations = this.moduleAssociations.get(matchingModule.id);
          const target = associations?.get(`${name}@${version}`);
          if (!target) {
            throw new Error(`Module ${matchingModule.id} tried to use un-imported interface ${name}@${version}`);
          }
          return path.join(target.manifest.exportsPath, request.substring(5));
        }
      }

      const mapped = this.pathMapper.resolve(request, manifest);
      if (mapped) {
        return mapped;
      }
    }

    if (request.startsWith('@ajs.raw/')) {
      const match = request.match(/^@ajs\.raw\/([^\/]+)\/([^@]+)@([^\/]+)(.*)/);
      if (match) {
        const [, id, name, version, file] = match;
        const target = this.modulesById.get(id);
        if (target) {
          const filePath = file.startsWith('/') ? file.substring(1) : file;
          return path.join(target.manifest.exportsPath, name, version, filePath);
        }
      }
    }

    return undefined;
  }
}
