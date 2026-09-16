import semver from "semver";
import { type ExecSyncOptions, execSync } from "node:child_process";

import { info, warning } from "./cli-ui";
import { CORE_PACKAGE_NAME } from "./core-version";
import type { PackageManagerName } from "./package-manager-name";
import {
  detectGlobalPackageManager,
  formatGlobalCommand,
  getGlobalInstallCommand,
  getLatestPackageSpec,
} from "./global-package-manager";

const UPDATE_COMMAND = "ajs update";

export async function warnIfOutdated(
  currentVersion: string,
  exec: (
    command: string,
    options: ExecSyncOptions,
  ) => Buffer | string = execSync,
  packageManager: PackageManagerName = detectGlobalPackageManager(),
): Promise<void> {
  try {
    const latestVersion = exec("npm view @antelopejs/core version", {
      timeout: 3000,
    })
      .toString()
      .trim();

    if (semver.lt(currentVersion, latestVersion)) {
      warning(
        `You are using an outdated version of AntelopeJS (${currentVersion}).`,
      );
      warning(`The latest version is ${latestVersion}.`);
      warning(`Please update by running: ${UPDATE_COMMAND}`);
      warning(
        `Or update it directly with: ${formatGlobalCommand(
          getGlobalInstallCommand(
            getLatestPackageSpec(CORE_PACKAGE_NAME),
            packageManager,
          ),
        )}`,
      );
    }
  } catch (error) {
    info(
      `Failed to check for updates: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
