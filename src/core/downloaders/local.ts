import * as path from 'path';
import { DownloaderRegistry } from './registry';
import { ModuleCache } from '../module-cache';
import { ModuleManifest } from '../module-manifest';
import { IFileSystem, ModuleSourceLocal } from '../../types';
import { NodeFileSystem } from '../filesystem';
import { CommandRunner } from './types';
import { expandHome, runInstallCommands } from './utils';
import { ExecuteCMD } from '../cli/command';
import { Logging } from '../../interfaces/logging/beta';

const Logger = new Logging.Channel('loader.local');

export interface LocalDownloaderDeps {
  fs?: IFileSystem;
  exec?: CommandRunner;
}

export function registerLocalDownloader(registry: DownloaderRegistry, deps: LocalDownloaderDeps = {}): void {
  const fs = deps.fs ?? new NodeFileSystem();
  const exec = deps.exec ?? ExecuteCMD;

  registry.register('local', 'path', async (_cache: ModuleCache, source: ModuleSourceLocal) => {
    const formattedPath = expandHome(source.path);
    if (!(await fs.exists(formattedPath))) {
      Logger.Error(`Path does not exist or is not accessible: ${formattedPath}`);
      throw new Error(`Path does not exist or is not accessible: ${formattedPath}`);
    }

    await runInstallCommands(exec, Logger, formattedPath, formattedPath, source.installCommand);

    const name = source.id ?? path.basename(formattedPath);
    const manifest = await ModuleManifest.create(formattedPath, source, name, fs);
    return [manifest];
  });
}
