import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { info, warning } from '../utils/cli-ui';
import chalk from 'chalk';

/**
 * Valid package manager options
 */
const VALID_PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm'];

// Default package manager to use if none is configured
const DEFAULT_PACKAGE_MANAGER = 'npm';

// Fallback versions if we can't detect
const FALLBACK_VERSIONS = {
  npm: 'npm@10.2.4',
  yarn: 'yarn@1.22.21',
  pnpm: 'pnpm@10.6.5',
};

/**
 * Get package manager configuration from local package.json
 * @param directory The directory containing package.json
 * @returns The package manager string or undefined if not found
 */
export async function getModulePackageManager(directory: string = '.'): Promise<string | undefined> {
  try {
    const packageJsonPath = path.join(directory, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.packageManager) {
        // Extract just the package manager name from the string (e.g., "pnpm@10.6.5" -> "pnpm")
        const pmName = packageJson.packageManager.split('@')[0];
        return VALID_PACKAGE_MANAGERS.includes(pmName) ? pmName : undefined;
      }
    }
    return undefined;
  } catch {
    // Ignore any errors reading package.json
    return undefined;
  }
}

/**
 * Get package manager with version string
 * @param packageManager The package manager name (npm, yarn, pnpm)
 * @returns The package manager with version string (e.g., npm@10.2.4)
 */
export function getPackageManagerWithVersion(packageManager: string): string {
  try {
    const versionOutput = execSync(`${packageManager} --version`, { encoding: 'utf8' }).trim();
    return `${packageManager}@${versionOutput}`;
  } catch {
    // Fallback to known versions if detection fails
    const fallbackVersion = FALLBACK_VERSIONS[packageManager as keyof typeof FALLBACK_VERSIONS];
    warning(`Could not detect ${packageManager} version, using ${fallbackVersion}`);
    return fallbackVersion;
  }
}

/**
 * Save package manager choice to package.json
 * @param packageManager The package manager to save (npm, yarn, pnpm)
 * @param directory The directory containing package.json
 */
export function savePackageManagerToPackageJson(packageManager: string, directory: string = '.'): void {
  const packageJsonPath = path.join(directory, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    warning(`Could not find package.json at ${packageJsonPath}`);
    return;
  }

  try {
    const packageJsonContent = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const packageManagerWithVersion = getPackageManagerWithVersion(packageManager);

    // Add the packageManager field with specific version
    packageJsonContent.packageManager = packageManagerWithVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJsonContent, null, 2));

    info(`Package manager set to ${chalk.cyan(packageManager)}`);
    return;
  } catch (err) {
    warning(
      `Could not update package.json with package manager setting: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
}

/**
 * Get the appropriate command to install specific packages
 * @param packages List of packages to install
 * @param isDev Whether to install as development dependencies
 * @param directory The directory to check for local package.json
 * @returns The full installation command
 */
export async function getInstallPackagesCommand(
  packages: string[] = [],
  isDev = false,
  directory: string = '.',
): Promise<string> {
  const validPackageManager = (await getModulePackageManager(directory)) || DEFAULT_PACKAGE_MANAGER;
  const packageList = packages.join(' ');
  const devFlag = isDev ? '-D' : '';

  switch (validPackageManager) {
    case 'pnpm':
      return `pnpm install ${devFlag} ${packageList} -C . --lockfile-dir .`.trim();
    case 'yarn':
      return `yarn add ${devFlag} ${packageList} -C . --lockfile-dir .`.trim();
    case 'npm':
    default:
      return `npm install ${isDev ? '--save-dev' : '--save'} ${packageList} -C . --lockfile-dir .`.trim();
  }
}

/**
 * Get the appropriate command to install dependencies from package.json
 * @param directory The directory to check for local package.json
 * @returns The install command
 */
export async function getInstallCommand(directory: string = '.'): Promise<string> {
  const validPackageManager = (await getModulePackageManager(directory)) || DEFAULT_PACKAGE_MANAGER;

  switch (validPackageManager) {
    case 'pnpm':
      return 'pnpm install';
    case 'yarn':
      return 'yarn';
    case 'npm':
    default:
      return 'npm install';
  }
}

/**
 * Parse the output from npm view command
 * @param output The command output
 * @returns The parsed version string
 */
export function parsePackageInfoOutput(output: string): string {
  return output.replace(/\n/g, '').trim();
}
