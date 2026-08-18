import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { IFileSystem } from "../../types";
import { NodeFileSystem } from "../filesystem";
import { info, warning } from "./cli-ui";

const VALID_PACKAGE_MANAGERS = ["npm", "yarn", "pnpm"] as const;
type PackageManagerName = (typeof VALID_PACKAGE_MANAGERS)[number];

const DEFAULT_PACKAGE_MANAGER: PackageManagerName = "npm";
const PACKAGE_MANAGER_PATTERN = /^(npm|yarn|pnpm)@([0-9A-Za-z._+-]+)$/;
const LOCKFILES: Record<PackageManagerName, string[]> = {
  npm: ["npm-shrinkwrap.json", "package-lock.json"],
  yarn: ["yarn.lock"],
  pnpm: ["pnpm-lock.yaml"],
};

const FALLBACK_VERSIONS: Record<PackageManagerName, string> = {
  npm: "npm@10.2.4",
  yarn: "yarn@1.22.21",
  pnpm: "pnpm@10.6.5",
};

interface InstallPackagesParams {
  executable: string;
  packageList: string;
  isDev: boolean;
}

interface InstallDependenciesParams {
  executable: string;
  hasLockfile: boolean;
  isProduction: boolean;
}

interface PackageManager {
  executable: string;
  name: PackageManagerName;
}

type InstallPackagesCommandBuilder = (params: InstallPackagesParams) => string;
type InstallDependenciesCommandBuilder = (
  params: InstallDependenciesParams,
) => string;

function compactCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

const INSTALL_COMMANDS: Record<
  PackageManagerName,
  InstallPackagesCommandBuilder
> = {
  pnpm: ({ executable, packageList, isDev }) =>
    compactCommand(
      `${executable} install ${isDev ? "-D" : ""} ${packageList} -C . --lockfile-dir .`,
    ),
  yarn: ({ executable, packageList, isDev }) =>
    compactCommand(
      `${executable} add ${isDev ? "-D" : ""} ${packageList} -C . --lockfile-dir .`,
    ),
  npm: ({ executable, packageList, isDev }) =>
    compactCommand(
      `${executable} install ${isDev ? "--save-dev" : "--save"} ${packageList} -C . --lockfile-dir .`,
    ),
};

const UNINSTALL_COMMANDS: Record<
  PackageManagerName,
  InstallDependenciesCommandBuilder
> = {
  pnpm: ({ executable, hasLockfile, isProduction }) =>
    compactCommand(
      `${executable} install ${isProduction ? "--prod" : ""} --ignore-workspace${hasLockfile ? " --frozen-lockfile --prefer-offline" : ""}`,
    ),
  yarn: ({ executable, hasLockfile, isProduction }) =>
    compactCommand(
      `${executable} install ${isProduction ? "--production" : ""}${hasLockfile ? " --frozen-lockfile --prefer-offline" : ""}`,
    ),
  npm: ({ executable, hasLockfile, isProduction }) =>
    compactCommand(
      `${executable} ${hasLockfile ? "ci --prefer-offline" : "install"} ${isProduction ? "--omit=dev" : ""}`,
    ),
};

function normalizePackageManager(packageManager?: string): PackageManagerName {
  if (!packageManager) {
    return DEFAULT_PACKAGE_MANAGER;
  }
  return VALID_PACKAGE_MANAGERS.includes(packageManager as PackageManagerName)
    ? (packageManager as PackageManagerName)
    : DEFAULT_PACKAGE_MANAGER;
}

function hasCorepack(): boolean {
  try {
    execSync("corepack --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolvePackageManager(packageManager?: string): PackageManager {
  const match = packageManager?.match(PACKAGE_MANAGER_PATTERN);
  const name = normalizePackageManager(match?.[1] ?? packageManager);
  const executable =
    match && hasCorepack() ? `corepack ${packageManager}` : name;
  return { executable, name };
}

async function hasPackageManagerLockfile(
  directory: string,
  packageManager: PackageManagerName,
  fileSystem: IFileSystem,
): Promise<boolean> {
  const lockfiles = LOCKFILES[packageManager];
  const matches = await Promise.all(
    lockfiles.map((lockfile) =>
      fileSystem.exists(path.join(directory, lockfile)),
    ),
  );
  return matches.includes(true);
}

export async function getModulePackageManager(
  directory: string = ".",
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<string | undefined> {
  try {
    const packageJsonPath = path.join(directory, "package.json");
    if (!(await fileSystem.exists(packageJsonPath))) {
      return undefined;
    }
    const packageJson = JSON.parse(
      await fileSystem.readFileString(packageJsonPath),
    );
    if (!packageJson.packageManager) {
      return undefined;
    }
    return PACKAGE_MANAGER_PATTERN.test(packageJson.packageManager) ||
      VALID_PACKAGE_MANAGERS.includes(packageJson.packageManager)
      ? packageJson.packageManager
      : undefined;
  } catch {
    return undefined;
  }
}

export function getPackageManagerWithVersion(packageManager: string): string {
  try {
    const versionOutput = execSync(`${packageManager} --version`, {
      encoding: "utf8",
    }).trim();
    return `${packageManager}@${versionOutput}`;
  } catch {
    const fallbackVersion =
      FALLBACK_VERSIONS[normalizePackageManager(packageManager)];
    warning(
      `Could not detect ${packageManager} version, using ${fallbackVersion}`,
    );
    return fallbackVersion;
  }
}

export function savePackageManagerToPackageJson(
  packageManager: string,
  directory: string = ".",
): void {
  const packageJsonPath = path.join(directory, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    warning(`Could not find package.json at ${packageJsonPath}`);
    return;
  }

  try {
    const packageJsonContent = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf8"),
    );
    const packageManagerWithVersion =
      getPackageManagerWithVersion(packageManager);
    packageJsonContent.packageManager = packageManagerWithVersion;
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(packageJsonContent, null, 2),
    );
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
  directory: string = ".",
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<string> {
  const packageManager = resolvePackageManager(
    await getModulePackageManager(directory, fileSystem),
  );
  return INSTALL_COMMANDS[packageManager.name]({
    executable: packageManager.executable,
    packageList: packages.join(" "),
    isDev,
  });
}

export async function getInstallCommand(
  directory: string = ".",
  isProduction = true,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<string> {
  const packageManager = resolvePackageManager(
    await getModulePackageManager(directory, fileSystem),
  );
  const hasLockfile = await hasPackageManagerLockfile(
    directory,
    packageManager.name,
    fileSystem,
  );
  return UNINSTALL_COMMANDS[packageManager.name]({
    executable: packageManager.executable,
    hasLockfile,
    isProduction,
  });
}

export function parsePackageInfoOutput(output: string): string {
  return output.replace(/\n/g, "").trim();
}
