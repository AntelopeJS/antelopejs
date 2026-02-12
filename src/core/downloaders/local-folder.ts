import * as path from 'path';
import { DownloaderRegistry } from './registry';
import { ModuleCache } from '../module-cache';
import { ModuleManifest } from '../module-manifest';
import { IFileSystem, ModuleSourceLocal, ModuleSourceLocalFolder } from '../../types';
import { NodeFileSystem } from '../filesystem';
import { expandHome, runInstallCommands } from './utils';
import { CommandRunner } from './types';
import { ExecuteCMD } from '../cli/command';
import { Logging } from '../../interfaces/logging/beta';

const Logger = new Logging.Channel('loader.local-folder');

export interface LocalFolderDownloaderDeps {
  fs?: IFileSystem;
  exec?: CommandRunner;
}

export function registerLocalFolderDownloader(
  registry: DownloaderRegistry,
  deps: LocalFolderDownloaderDeps = {},
): void {
  const fs = deps.fs ?? new NodeFileSystem();
  const exec = deps.exec ?? ExecuteCMD;

  registry.register('local-folder', 'path', async (_cache: ModuleCache, source: ModuleSourceLocalFolder) => {
    const searchPath = expandHome(source.path);
    const entries = await fs.readdir(searchPath);
    const manifests: ModuleManifest[] = [];

    for (const name of entries) {
      const folder = path.join(searchPath, name);
      const stat = await fs.stat(folder);
      if (!stat.isDirectory()) continue;

      const moduleName = source.id ? `${source.id}-${name}` : name;
      await runInstallCommands(exec, Logger, moduleName, folder, source.installCommand);
      const moduleSource: ModuleSourceLocal = {
        type: 'local',
        path: folder,
        watchDir: source.watchDir,
        installCommand: source.installCommand,
      };
      const manifest = await ModuleManifest.create(folder, moduleSource, moduleName, fs);
      manifests.push(manifest);
    }

    return manifests;
  });
}
