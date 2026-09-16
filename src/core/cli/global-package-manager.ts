import { realpathSync } from "node:fs";

export type GlobalPackageManagerName = "npm" | "pnpm" | "yarn";

export interface GlobalCommand {
  executable: string;
  args: string[];
}

type GlobalCommandBuilder = (packageSpec: string) => GlobalCommand;

const DEFAULT_GLOBAL_PACKAGE_MANAGER: GlobalPackageManagerName = "npm";

const GLOBAL_INSTALL_COMMANDS: Record<
  GlobalPackageManagerName,
  GlobalCommandBuilder
> = {
  npm: (packageSpec) => ({
    executable: "npm",
    args: ["install", "-g", packageSpec],
  }),
  pnpm: (packageSpec) => ({
    executable: "pnpm",
    args: ["add", "-g", packageSpec],
  }),
  yarn: (packageSpec) => ({
    executable: "yarn",
    args: ["global", "add", packageSpec],
  }),
};

const PACKAGE_MANAGER_PATH_MARKERS: [GlobalPackageManagerName, RegExp][] = [
  ["pnpm", /[\\/]\.?pnpm[\\/]/i],
  ["yarn", /[\\/]\.?yarn[\\/]/i],
  ["npm", /[\\/]node_modules[\\/]/i],
];

export interface GlobalPackageManagerDetection {
  binaryPath?: string;
  resolvePath?: (target: string) => string;
}

function resolveBinaryPath(
  binaryPath: string,
  resolvePath: (target: string) => string,
): string {
  try {
    return resolvePath(binaryPath);
  } catch {
    return binaryPath;
  }
}

export function detectGlobalPackageManager(
  detection: GlobalPackageManagerDetection = {},
): GlobalPackageManagerName {
  const binaryPath = detection.binaryPath ?? process.argv[1] ?? "";
  if (!binaryPath) {
    return DEFAULT_GLOBAL_PACKAGE_MANAGER;
  }
  const resolved = resolveBinaryPath(
    binaryPath,
    detection.resolvePath ?? realpathSync,
  );
  const match = PACKAGE_MANAGER_PATH_MARKERS.find(([, pattern]) =>
    pattern.test(resolved),
  );
  return match?.[0] ?? DEFAULT_GLOBAL_PACKAGE_MANAGER;
}

export function getGlobalInstallCommand(
  packageSpec: string,
  packageManager: GlobalPackageManagerName = detectGlobalPackageManager(),
): GlobalCommand {
  return GLOBAL_INSTALL_COMMANDS[packageManager](packageSpec);
}

export function formatGlobalCommand(command: GlobalCommand): string {
  return [command.executable, ...command.args].join(" ");
}
