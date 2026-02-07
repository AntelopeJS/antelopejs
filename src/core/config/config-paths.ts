import path from 'path';
import { IFileSystem } from '../../types';

export const TS_CONFIG_FILE = 'antelope.config.ts';
export const DEFAULT_ENV = 'default';
export const DEFAULT_CACHE_DIR = '.antelope/cache';

export async function tryFindConfigPath(projectFolder: string, fs: IFileSystem): Promise<string | undefined> {
  const resolved = path.resolve(projectFolder);
  const tsPath = path.join(resolved, TS_CONFIG_FILE);

  if (await fs.exists(tsPath)) {
    return tsPath;
  }

  return undefined;
}

export async function findConfigPath(projectFolder: string, fs: IFileSystem): Promise<string> {
  const configPath = await tryFindConfigPath(projectFolder, fs);

  if (!configPath) {
    throw new Error(`No configuration file found. Expected ${TS_CONFIG_FILE} in ${projectFolder}.`);
  }

  return configPath;
}

export function getModuleConfigPath(projectFolder: string, moduleName: string): string {
  return path.join(path.resolve(projectFolder), `antelope.${moduleName}.json`);
}
