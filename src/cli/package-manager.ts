import { readUserConfig } from './common';

/**
 * Valid package manager options
 */
const VALID_PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm'];

/**
 * Get the appropriate command to install specific packages
 * @param packages List of packages to install
 * @param isDev Whether to install as development dependencies
 * @returns The full installation command
 */
export async function getInstallPackagesCommand(packages: string[] = [], isDev = false): Promise<string> {
  const { packageManager } = await readUserConfig();

  // Ensure packageManager is valid, default to pnpm if not
  const validPackageManager = VALID_PACKAGE_MANAGERS.includes(packageManager) ? packageManager : 'pnpm';

  const packageList = packages.join(' ');
  const devFlag = isDev ? '-D' : '';

  switch (validPackageManager) {
    case 'npm':
      return `npm install ${isDev ? '--save-dev' : '--save'} ${packageList} -C . --lockfile-dir .`.trim();
    case 'yarn':
      return `yarn add ${devFlag} ${packageList} -C . --lockfile-dir .`.trim();
    case 'pnpm':
    default:
      return `pnpm add ${devFlag} ${packageList} -C . --lockfile-dir .`.trim();
  }
}

/**
 * Get the appropriate command to install dependencies from package.json
 * @returns The install command
 */
export async function getInstallCommand(): Promise<string> {
  const { packageManager } = await readUserConfig();

  // Ensure packageManager is valid, default to pnpm if not
  const validPackageManager = VALID_PACKAGE_MANAGERS.includes(packageManager) ? packageManager : 'pnpm';

  switch (validPackageManager) {
    case 'npm':
      return 'npm install';
    case 'yarn':
      return 'yarn';
    case 'pnpm':
    default:
      return 'pnpm install';
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
