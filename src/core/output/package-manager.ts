import fs from "node:fs";
import path from "node:path";

import type { IFileSystem } from "../../types";
import { NodeFileSystem } from "../filesystem";
import { info, warning } from "./cli-ui";
import { loadChildProcess } from "./child-process";
import { packageJsonWith } from "./package-json-layout";
import {
  DEFAULT_PACKAGE_MANAGER,
  PACKAGE_MANAGER_NAMES,
  type PackageManagerName,
} from "./package-manager-name";
import { findPnpmWorkspaceRoot } from "./pnpm-workspace";
import { getProcessPalette } from "./tasks";
import { isObject, isString } from "../../utils";
const PACKAGE_MANAGER_PATTERN = /^(npm|yarn|pnpm)@([0-9A-Za-z._+-]+)$/;
const LOCKFILES: Record<PackageManagerName, string[]> = {
  npm: ["npm-shrinkwrap.json", "package-lock.json"],
  yarn: ["yarn.lock"],
  pnpm: ["pnpm-lock.yaml"],
};

/** Every lockfile name a module's package manager can write, npm, yarn or pnpm. */
export const MODULE_LOCKFILE_NAMES: readonly string[] =
  Object.values(LOCKFILES).flat();

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
  /** Install the folder alone, as pnpm's `--ignore-workspace` does, even inside a workspace. */
  ignoreWorkspace: boolean;
  isLockfileFrozen: boolean;
  isLockfileUpdated: boolean;
  isProduction: boolean;
  /**
   * Relax peer dependency resolution. Only npm understands this flag; the other
   * package managers ignore peer conflicts or resolve them on their own.
   */
  useLegacyPeerDeps: boolean;
}

interface PackageManager {
  executable: string;
  name: PackageManagerName;
}

type LockfileMode = "frozen" | "update";

type InstallPackagesCommandBuilder = (params: InstallPackagesParams) => string;
type InstallDependenciesCommandBuilder = (
  params: InstallDependenciesParams,
) => string;

function getLockfileFlag({
  isLockfileFrozen,
  isLockfileUpdated,
}: InstallDependenciesParams): string {
  if (isLockfileFrozen) {
    return "--frozen-lockfile";
  }
  return isLockfileUpdated ? "--no-frozen-lockfile" : "";
}

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
  pnpm: (params) =>
    compactCommand(
      `${params.executable} install ${params.isProduction ? "--prod" : ""} ${params.ignoreWorkspace ? "--ignore-workspace" : ""} ${getLockfileFlag(params)} ${params.hasLockfile ? "--prefer-offline" : ""}`,
    ),
  yarn: (params) =>
    compactCommand(
      `${params.executable} install ${params.isProduction ? "--production" : ""} ${getLockfileFlag(params)} ${params.hasLockfile ? "--prefer-offline" : ""}`,
    ),
  npm: ({
    executable,
    hasLockfile,
    isLockfileFrozen,
    isProduction,
    useLegacyPeerDeps,
  }) =>
    compactCommand(
      `${executable} ${isLockfileFrozen ? "ci --prefer-offline" : `install${hasLockfile ? " --prefer-offline" : ""}`} ${isProduction ? "--omit=dev" : ""} ${useLegacyPeerDeps ? "--legacy-peer-deps" : ""}`,
    ),
};

function normalizePackageManager(packageManager?: string): PackageManagerName {
  if (!packageManager) {
    return DEFAULT_PACKAGE_MANAGER;
  }
  return (
    PACKAGE_MANAGER_NAMES.find((name) => name === packageManager) ??
    DEFAULT_PACKAGE_MANAGER
  );
}

function hasCorepack(): boolean {
  try {
    loadChildProcess().execSync("corepack --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function packageManagerName(packageManager?: string): PackageManagerName {
  return normalizePackageManager(
    packageManager?.match(PACKAGE_MANAGER_PATTERN)?.[1] ?? packageManager,
  );
}

function resolvePackageManager(packageManager?: string): PackageManager {
  const name = packageManagerName(packageManager);
  const executable =
    packageManager !== undefined &&
    PACKAGE_MANAGER_PATTERN.test(packageManager) &&
    hasCorepack()
      ? `corepack ${packageManager}`
      : name;
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

/**
 * The lockfile the package manager of the module in `directory` wrote there,
 * or `undefined` when it wrote none.
 */
export async function findModuleLockfile(
  directory: string,
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<string | undefined> {
  const lockfiles =
    LOCKFILES[
      packageManagerName(await getModulePackageManager(directory, fileSystem))
    ];
  const matches = await Promise.all(
    lockfiles.map((lockfile) =>
      fileSystem.exists(path.join(directory, lockfile)),
    ),
  );
  return lockfiles.find((_, index) => matches[index]);
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
    const packageJson: unknown = JSON.parse(
      await fileSystem.readFileString(packageJsonPath),
    );
    const packageManager = isObject(packageJson)
      ? packageJson.packageManager
      : undefined;
    if (!isString(packageManager) || packageManager === "") {
      return undefined;
    }
    return PACKAGE_MANAGER_PATTERN.test(packageManager) ||
      PACKAGE_MANAGER_NAMES.some((name) => name === packageManager)
      ? packageManager
      : undefined;
  } catch {
    return undefined;
  }
}

export function getPackageManagerWithVersion(packageManager: string): string {
  try {
    const versionOutput = loadChildProcess()
      .execSync(`${packageManager} --version`, {
        encoding: "utf8",
      })
      .trim();
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
    const packageJsonContent: unknown = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf8"),
    );
    if (!isObject(packageJsonContent)) {
      throw new TypeError(`${packageJsonPath} does not hold a JSON object`);
    }
    const currentPackageManager = packageJsonContent.packageManager;
    if (
      isString(currentPackageManager) &&
      currentPackageManager.match(PACKAGE_MANAGER_PATTERN)?.[1] ===
        packageManager
    ) {
      return;
    }
    const packageManagerWithVersion =
      getPackageManagerWithVersion(packageManager);
    fs.writeFileSync(
      packageJsonPath,
      packageJsonWith(
        packageJsonContent,
        "packageManager",
        packageManagerWithVersion,
      ),
    );
    info(`Package manager set to ${getProcessPalette().bold(packageManager)}`);
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

/** How {@link installDependenciesCommand} installs a folder. */
interface InstallCommandOptions {
  isProduction: boolean;
  lockfileMode: LockfileMode;
  useLegacyPeerDeps: boolean;
  /** Whether pnpm installs the folder alone, ignoring a workspace it is part of. */
  ignoreWorkspace: boolean;
  /** The package manager of a folder whose package.json names none. */
  fallbackPackageManager?: PackageManagerName;
}

async function installDependenciesCommand(
  directory: string,
  fileSystem: IFileSystem,
  options: InstallCommandOptions,
): Promise<string> {
  const packageManager = resolvePackageManager(
    (await getModulePackageManager(directory, fileSystem)) ??
      options.fallbackPackageManager,
  );
  const hasLockfile = await hasPackageManagerLockfile(
    directory,
    packageManager.name,
    fileSystem,
  );
  return UNINSTALL_COMMANDS[packageManager.name]({
    executable: packageManager.executable,
    hasLockfile,
    ignoreWorkspace: options.ignoreWorkspace,
    isLockfileFrozen: hasLockfile && options.lockfileMode === "frozen",
    isLockfileUpdated: options.lockfileMode === "update",
    isProduction: options.isProduction,
    useLegacyPeerDeps: options.useLegacyPeerDeps,
  });
}

/**
 * The command that installs the dependencies of the project or module in
 * `directory`. A folder that holds a `pnpm-workspace.yaml`, or that an
 * enclosing workspace lists in its `packages`, is installed through that
 * workspace, with its package manager and lockfile, so `workspace:`
 * dependencies resolve; any other folder is installed alone, ignoring a
 * workspace that encloses it.
 */
export async function getInstallCommand(
  directory: string = ".",
  isProduction = true,
  fileSystem: IFileSystem = new NodeFileSystem(),
  lockfileMode: LockfileMode = "frozen",
  useLegacyPeerDeps = false,
): Promise<string> {
  const workspaceRoot = await findPnpmWorkspaceRoot(directory, fileSystem);
  return installDependenciesCommand(workspaceRoot ?? directory, fileSystem, {
    isProduction,
    lockfileMode,
    useLegacyPeerDeps,
    ignoreWorkspace: workspaceRoot === undefined,
    fallbackPackageManager: workspaceRoot === undefined ? undefined : "pnpm",
  });
}

/**
 * The command that installs a module in the module cache: production
 * dependencies, from its lockfile when it has one, with npm peer conflicts
 * relaxed, and always alone, ignoring any workspace that encloses the cache
 * or that the module declares.
 */
export function getModuleCacheInstallCommand(
  directory: string = ".",
  fileSystem: IFileSystem = new NodeFileSystem(),
): Promise<string> {
  return installDependenciesCommand(directory, fileSystem, {
    isProduction: true,
    lockfileMode: "frozen",
    useLegacyPeerDeps: true,
    ignoreWorkspace: true,
  });
}

export function parsePackageInfoOutput(output: string): string {
  return output.replace(/\n/g, "").trim();
}
