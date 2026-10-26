export const PACKAGE_MANAGER_NAMES = ["npm", "yarn", "pnpm"] as const;

export type PackageManagerName = (typeof PACKAGE_MANAGER_NAMES)[number];

export const DEFAULT_PACKAGE_MANAGER: PackageManagerName = "npm";

export const WINDOWS_PLATFORM = "win32";

const WINDOWS_COMMAND_EXTENSION = ".cmd";

export function packageManagerExecutable(
  packageManager: PackageManagerName,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === WINDOWS_PLATFORM
    ? `${packageManager}${WINDOWS_COMMAND_EXTENSION}`
    : packageManager;
}
