import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { info, warning } from './cli-ui';
import { IFileSystem } from '../../types';
import { NodeFileSystem } from '../filesystem';

const VALID_PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm'] as const;
type PackageManagerName = (typeof VALID_PACKAGE_MANAGERS)[number];

const DEFAULT_PACKAGE_MANAGER: PackageManagerName = 'npm';

const FALLBACK_VERSIONS: Record<PackageManagerName, string> = {
  npm: 'npm@10.2.4',
  yarn: 'yarn@1.22.21',
  pnpm: 'pnpm@10.6.5',
};

interface InstallPackagesParams {
  packageList: string;
  isDev: boolean;
}

interface InstallDependenciesParams {
  isProduction: boolean;
}

type InstallPackagesCommandBuilder = (params: InstallPackagesParams) => string;
type InstallDependenciesCommandBuilder = (params: InstallDependenciesParams) => string;

const INSTALL_COMMANDS: Record<PackageManagerName, InstallPackagesCommandBuilder> = {
  pnpm: ({ packageList, isDev }) => `pnpm install ${isDev ? '-D' : ''} ${packageList} -C . --lockfile-dir .`.trim(),
  yarn: ({ packageList, isDev }) => `yarn add ${isDev ? '-D' : ''} ${packageList} -C . --lockfile-dir .`.trim(),
  npm: ({ packageList, isDev }) =>
    `npm install ${isDev ? '--save-dev' : '--save'} ${packageList} -C . --lockfile-dir .`.trim(),
};

const UNINSTALL_COMMANDS: Record<PackageManagerName, InstallDependenciesCommandBuilder> = {
  pnpm: ({ isProduction }) => `pnpm install ${isProduction ? '--prod' : ''} --ignore-workspace`,
  yarn: ({ isProduction }) => `yarn install ${isProduction ? '--production' : ''}`,
  npm: ({ isProduction }) => `npm install ${isProduction ? '--omit=dev' : ''}`,
};

function normalizePackageManager(packageManager?: string): PackageManagerName {
  if (!packageManager) {
    return DEFAULT_PACKAGE_MANAGER;
  }
  return VALID_PACKAGE_MANAGERS.includes(packageManager as PackageManagerName)
    ? (packageManager as PackageManagerName)
    : DEFAULT_PACKAGE_MANAGER;
}

export async function getModulePackageManager(
  directory: string = '.',
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<string | undefined> {
  try {
    const packageJsonPath = path.join(directory, 'package.json');
    if (!(await fileSystem.exists(packageJsonPath))) {
      return undefined;
    }
    const packageJson = JSON.parse(await fileSystem.readFileString(packageJsonPath));
    if (!packageJson.packageManager) {
      return undefined;
    }
    const pmName = packageJson.packageManager.split('@')[0];
    return VALID_PACKAGE_MANAGERS.includes(pmName as PackageManagerName) ? pmName : undefined;
  } catch {
    return undefined;
  }
}

export function getPackageManagerWithVersion(packageManager: string): string {
  try {
    const versionOutput = execSync(`${packageManager} --version`, { encoding: 'utf8' }).trim();
    return `${packageManager}@${versionOutput}`;
  } catch {
    const fallbackVersion = FALLBACK_VERSIONS[normalizePackageManager(packageManager)];
    warning(`Could not detect ${packageManager} version, using ${fallbackVersion}`);
    return fallbackVersion;
  }
}

export function savePackageManagerToPackageJson(packageManager: string, directory: string = '.'): void {
  const packageJsonPath = path.join(directory, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    warning(`Could not find package.json at ${packageJsonPath}`);
    return;
  }

  try {
    const packageJsonContent = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const packageManagerWithVersion = getPackageManagerWithVersion(packageManager);
    packageJsonContent.packageManager = packageManagerWithVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJsonContent, null, 2));
    info(`Package manager set to ${chalk.cyan(packageManager)}`);
  } catch (err) {
    warning(
      `Could not update package.json with package manager setting: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function getInstallPackagesCommand(
  packages: string[] = [],
  isDev = false,
  directory: string = '.',
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<string> {
  const packageManager = normalizePackageManager(await getModulePackageManager(directory, fileSystem));
  return INSTALL_COMMANDS[packageManager]({
    packageList: packages.join(' '),
    isDev,
  });
}

export async function getInstallCommand(
  directory: string = '.',
  isProduction = true,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<string> {
  const packageManager = normalizePackageManager(await getModulePackageManager(directory, fileSystem));
  return UNINSTALL_COMMANDS[packageManager]({ isProduction });
}

export function parsePackageInfoOutput(output: string): string {
  return output.replace(/\n/g, '').trim();
}
