import { Option } from 'commander';
import { stat, writeFile as writeFileNode } from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import { AntelopeConfig, IFileSystem } from '../../types';
import { NodeFileSystem } from '../filesystem';
import { mkdirSync } from 'fs';
import { ModulePackageJson } from '../module-manifest';
import { warning } from './cli-ui';
import chalk from 'chalk';

const DEFAULT_INDENTATION = '  ';

/**
 * Detects the indentation character from a file
 * @param filePath Path to the file
 * @returns The detected indentation character or default (2 spaces)
 */
export async function detectIndentation(
  filePath: string,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<string> {
  try {
    const content = await fileSystem.readFileString(filePath);
    const match = content.match(/\n([\t ]+)/);

    if (match && match[1]) {
      const firstChar = match[1][0];
      return firstChar === '\t' ? '\t' : '  ';
    }
  } catch {
    //
  }
  return DEFAULT_INDENTATION;
}

// Definition of the default git repository
export const DEFAULT_GIT_REPO = 'https://github.com/AntelopeJS/interfaces.git';

// Utility function to display warning for non-default git repositories
export async function displayNonDefaultGitWarning(gitUrl: string) {
  if (gitUrl !== DEFAULT_GIT_REPO) {
    warning(chalk.yellow.bold(' WARNING: Using non-default git repository ⚠️'));
    warning(
      'You are using a non-official git repository for interfaces. These interfaces may not adhere to community quality standards or best practices.',
    );
    // Wait for 3 seconds to ensure the user sees the warning
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log(''); // Add a blank line after the warning
  }
}

export namespace Options {
  export const project = new Option('-p, --project <path>', 'Path to AntelopeJS project')
    .default(path.resolve(process.cwd()))
    .env('ANTELOPEJS_PROJECT')
    .argParser((val) => path.resolve(val));
  export const module = new Option('-m, --module <path>', 'Path to AntelopeJS module')
    .default(path.resolve(process.cwd()))
    .env('ANTELOPEJS_MODULE')
    .argParser((val) => path.resolve(val));
  export const git = new Option('-g, --git <url>', 'URL to git interfaces').env('ANTELOPEJS_GIT');
  export const verbose = new Option(
    '--verbose [=channels]',
    'Enable verbose logging (TRACE level) for specific log channels (comma-separated).',
  )
    .env('ANTELOPEJS_VERBOSE')
    .argParser((val) => val.replaceAll(/%/g, '*').split(','));
}

async function writeJsonFile(
  filePath: string,
  data: unknown,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<void> {
  const indentation = await detectIndentation(filePath, fileSystem);
  await fileSystem.writeFile(filePath, JSON.stringify(data, null, indentation) + '\n');
}

async function readJsonFile<T>(
  filePath: string,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<T | undefined> {
  if (!(await fileSystem.exists(filePath))) {
    return undefined;
  }
  return JSON.parse(await fileSystem.readFileString(filePath));
}

/*
 * AntelopeJS configuration
 */
export async function writeConfig(
  project: string,
  data: Partial<AntelopeConfig>,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<void> {
  const configPath = path.join(project, 'antelope.json');
  await writeJsonFile(configPath, data, fileSystem);
}

export async function readConfig(
  project: string,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<AntelopeConfig | undefined> {
  return readJsonFile<AntelopeConfig>(path.join(project, 'antelope.json'), fileSystem);
}

/*
 * Node package configuration
 */
export async function writeModuleManifest(
  module: string,
  data: ModulePackageJson,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<void> {
  await writeJsonFile(path.join(module, 'package.json'), data, fileSystem);
}

export async function readModuleManifest(
  module: string,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<ModulePackageJson | undefined> {
  return readJsonFile<ModulePackageJson>(path.join(module, 'package.json'), fileSystem);
}

/*
 * User configuration
 */
export interface UserConfig {
  git: string;
}

export function getDefaultUserConfig(): UserConfig {
  return {
    git: DEFAULT_GIT_REPO,
  };
}

export async function writeUserConfig(data: UserConfig): Promise<void> {
  const folderPath = path.join(homedir(), '.antelopejs');
  const configPath = path.join(folderPath, 'config.json');
  if (!(await stat(folderPath).catch(() => false))) {
    mkdirSync(folderPath, { recursive: true });
  }
  const indentation = await detectIndentation(configPath, new NodeFileSystem());
  await writeFileNode(configPath, JSON.stringify(data, null, indentation) + '\n');
}

export async function readUserConfig(): Promise<UserConfig> {
  const configPath = path.join(homedir(), '.antelopejs', 'config.json');
  if (!(await stat(configPath).catch(() => false))) {
    return getDefaultUserConfig();
  }
  const config = await readJsonFile<UserConfig>(configPath, new NodeFileSystem());
  return config ?? getDefaultUserConfig();
}
