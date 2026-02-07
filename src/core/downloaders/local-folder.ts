import * as path from 'path';
import { DownloaderRegistry } from './registry';
import { ModuleCache } from '../module-cache';
import { ModuleManifest } from '../module-manifest';
import { IFileSystem, ModuleSourceLocal, ModuleSourceLocalFolder } from '../../types';
import { NodeFileSystem } from '../filesystem';
import { expandHome } from './utils';

export interface LocalFolderDownloaderDeps {
  fs?: IFileSystem;
}

export function registerLocalFolderDownloader(
  registry: DownloaderRegistry,
  deps: LocalFolderDownloaderDeps = {},
): void {
  const fs = deps.fs ?? new NodeFileSystem();

  registry.register('local-folder', 'path', async (_cache: ModuleCache, source: ModuleSourceLocalFolder) => {
    const searchPath = expandHome(source.path);
    const entries = await fs.readdir(searchPath);
    const manifests: ModuleManifest[] = [];

    for (const name of entries) {
      const folder = path.join(searchPath, name);
      const stat = await fs.stat(folder);
      if (!stat.isDirectory()) continue;

      const moduleSource: ModuleSourceLocal = { type: 'local', path: folder };
      const moduleName = source.id ? `${source.id}-${name}` : name;
      const manifest = await ModuleManifest.create(folder, moduleSource, moduleName, fs);
      manifests.push(manifest);
    }

    return manifests;
  });
}
