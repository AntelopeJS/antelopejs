import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";

import {
  buildProcessInvocation,
  DEFAULT_PACKAGE_MANAGER,
  packageManagerExecutable,
  type PackageManagerName,
} from "../core/output";

const LATEST_TAG = "latest";
const GLOBAL_ROOT_TIMEOUT_MS = 5000;

export interface GlobalCommand {
  executable: string;
  args: string[];
}

export interface GlobalInstallation {
  packageManager: PackageManagerName;
  binaryPath: string;
}

export type GlobalInstallationDetector = () => GlobalInstallation | undefined;

type PathResolver = (target: string) => string;

export interface GlobalInstallationDetection {
  binaryPath?: string;
  resolvePath?: PathResolver;
  platform?: NodeJS.Platform;
}

interface GlobalLocationMarker {
  packageManager: PackageManagerName;
  pattern: RegExp;
}

function globalInstallArgs(
  packageManager: PackageManagerName,
  packageSpec: string,
): string[] {
  switch (packageManager) {
    case "npm":
      return ["install", "-g", packageSpec];
    case "pnpm":
      return ["add", "-g", packageSpec];
    case "yarn":
      return ["global", "add", packageSpec];
  }
}

function globalRootArgs(packageManager: PackageManagerName): string[] {
  return packageManager === "yarn" ? ["global", "dir"] : ["root", "-g"];
}

const GLOBAL_ROOT_SEGMENTS: Record<PackageManagerName, string[]> = {
  npm: [],
  pnpm: [],
  yarn: ["node_modules"],
};

const GLOBAL_LOCATION_MARKERS: GlobalLocationMarker[] = [
  { packageManager: "pnpm", pattern: /[\\/]pnpm[\\/]global[\\/]/i },
  { packageManager: "yarn", pattern: /[\\/]\.?yarn[\\/]global[\\/]/i },
  { packageManager: "npm", pattern: /[\\/]lib[\\/]node_modules[\\/]/i },
  { packageManager: "npm", pattern: /[\\/]npm[\\/]node_modules[\\/]/i },
];

function resolveBinaryPath(
  binaryPath: string,
  resolvePath: PathResolver,
): string {
  try {
    return resolvePath(binaryPath);
  } catch {
    return binaryPath;
  }
}

export function detectGlobalInstallation(
  detection: GlobalInstallationDetection = {},
): GlobalInstallation | undefined {
  const binaryPath = detection.binaryPath ?? process.argv[1] ?? "";
  if (!binaryPath) {
    return undefined;
  }
  const resolved = resolveBinaryPath(
    binaryPath,
    detection.resolvePath ?? realpathSync,
  );
  const marker = GLOBAL_LOCATION_MARKERS.find(({ pattern }) =>
    pattern.test(resolved),
  );
  return marker
    ? { packageManager: marker.packageManager, binaryPath: resolved }
    : undefined;
}

export function detectGlobalPackageManager(
  detection: GlobalInstallationDetection = {},
): PackageManagerName {
  return (
    detectGlobalInstallation(detection)?.packageManager ??
    DEFAULT_PACKAGE_MANAGER
  );
}

export function getGlobalInstallCommand(
  packageSpec: string,
  packageManager: PackageManagerName = detectGlobalPackageManager(),
  platform: NodeJS.Platform = process.platform,
): GlobalCommand {
  return {
    executable: packageManagerExecutable(packageManager, platform),
    args: globalInstallArgs(packageManager, packageSpec),
  };
}

export function getLatestPackageSpec(packageName: string): string {
  return `${packageName}@${LATEST_TAG}`;
}

export function getGlobalRootCommand(
  packageManager: PackageManagerName,
  platform: NodeJS.Platform = process.platform,
): GlobalCommand {
  return {
    executable: packageManagerExecutable(packageManager, platform),
    args: globalRootArgs(packageManager),
  };
}

export function formatGlobalCommand(command: GlobalCommand): string {
  return [command.executable, ...command.args].join(" ");
}

export type GlobalRootResolver = (
  packageManager: PackageManagerName,
) => Promise<string | undefined>;

export const nodeGlobalRootResolver: GlobalRootResolver = async (
  packageManager,
) => {
  const command = getGlobalRootCommand(packageManager);
  const invocation = buildProcessInvocation(command.executable, command.args);
  const result = spawnSync(invocation.executable, invocation.args, {
    encoding: "utf8",
    timeout: GLOBAL_ROOT_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "ignore"],
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
  if (result.error || result.status !== 0) {
    return undefined;
  }
  const output = result.stdout.trim();
  return output
    ? join(output, ...GLOBAL_ROOT_SEGMENTS[packageManager])
    : undefined;
};
