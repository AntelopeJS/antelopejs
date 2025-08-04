import path from 'path';
import { RegisterLoader, ModuleSource } from '.';
import { readdir, access } from 'fs/promises';
import { ExecuteCMD } from '../../utils/command';
import { ModuleManifest } from '../manifest';
import { ModuleCache } from '../cache';
import os from 'node:os';
import { Logging } from '../../interfaces/logging/beta';
import { VERBOSE_SECTIONS } from '../../logging';
import { terminalDisplay } from '../../logging/terminal-display';

export interface ModuleSourceLocal extends ModuleSource {
  type: 'local';
  path: string;
  main?: string;
  watchDir?: string | string[];
  installCommand?: string | string[];
}

function ReplaceUnixRelativeHome(path: string) {
  const homeDir = os.homedir();

  if (path.startsWith('~')) {
    return homeDir + path.slice(1);
  }

  if (path.includes('~')) {
    const parts = path.split('~');
    if (parts[0].startsWith(homeDir)) {
      return homeDir + '/' + parts[1].replace(/^\/+/, '');
    }
    return path.replace(/~/g, homeDir).replace(/\/+/g, '/');
  }

  return path;
}

RegisterLoader('local', 'path', async (_: ModuleCache, source: ModuleSourceLocal) => {
  const formattedPath = ReplaceUnixRelativeHome(source.path);
  try {
    await access(formattedPath);
  } catch (error) {
    Logging.Error(`Path does not exist or is not accessible: ${formattedPath}`);
    throw error;
  }
  if (source.installCommand) {
    Logging.Verbose(VERBOSE_SECTIONS.INSTALL, `Running install commands for ${formattedPath}`);
    await terminalDisplay.startSpinner(`Installing dependencies for ${formattedPath}`);
    if (Array.isArray(source.installCommand)) {
      for (const command of source.installCommand) {
        Logging.Verbose(VERBOSE_SECTIONS.CMD, `Executing command: ${command}`);
        const result = await ExecuteCMD(command, { cwd: formattedPath });
        if (result.code !== 0) {
          await terminalDisplay.failSpinner(`Failed to install dependencies: ${result.stderr}`);
          throw new Error(`Failed to install dependencies: ${result.stderr}`);
        }
      }
    } else {
      Logging.Verbose(VERBOSE_SECTIONS.CMD, `Executing command: ${source.installCommand}`);
      const result = await ExecuteCMD(source.installCommand, { cwd: formattedPath });
      if (result.code !== 0) {
        await terminalDisplay.failSpinner(`Failed to install dependencies: ${result.stderr}`);
        throw new Error(`Failed to install dependencies: ${result.stderr}`);
      }
    }
    await terminalDisplay.stopSpinner(`Dependencies installed for ${formattedPath}`);
  }
  return [new ModuleManifest(formattedPath, source)];
});

export interface ModuleSourceLocalFolder extends ModuleSource {
  type: 'local-folder';
  path: string;
}

RegisterLoader('local-folder', 'path', (_: ModuleCache, source: ModuleSourceLocalFolder) => {
  const searchPath = ReplaceUnixRelativeHome(source.path);
  return readdir(searchPath).then((names) =>
    names.map((name) => {
      const folder = path.join(searchPath, name);
      return new ModuleManifest(folder, { type: 'local', path: folder } as ModuleSourceLocal);
    }),
  );
});
