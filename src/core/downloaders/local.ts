import * as path from 'path';
import { DownloaderRegistry } from './registry';
import { ModuleCache } from '../module-cache';
import { ModuleManifest } from '../module-manifest';
import { IFileSystem, ModuleSourceLocal } from '../../types';
import { NodeFileSystem } from '../filesystem';
import { CommandRunner } from './types';
import { expandHome } from './utils';
import { ExecuteCMD } from '../cli/command';
import { Logging } from '../../interfaces/logging/beta';
import { terminalDisplay } from '../cli/terminal-display';

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

    if (source.installCommand) {
      Logger.Debug(`Running install commands for ${formattedPath}`);
      await terminalDisplay.startSpinner(`Installing dependencies for ${formattedPath}`);
      const commands = Array.isArray(source.installCommand) ? source.installCommand : [source.installCommand];
      for (const command of commands) {
        Logger.Debug(`Executing command: ${command}`);
        const result = await exec(command, { cwd: formattedPath });
        if (result.code !== 0) {
          await terminalDisplay.failSpinner(`Failed to install dependencies: ${result.stderr}`);
          throw new Error(`Failed to install dependencies: ${result.stderr || result.stdout}`);
        }
      }
      await terminalDisplay.stopSpinner(`Dependencies installed for ${formattedPath}`);
    }

    const name = source.id ?? path.basename(formattedPath);
    const manifest = await ModuleManifest.create(formattedPath, source, name, fs);
    return [manifest];
  });
}
