import semver from "semver";
import { type ExecSyncOptions, execSync } from "node:child_process";

import { info, warning } from "./cli-ui";
import { CORE_PACKAGE_NAME } from "./core-version";
import {
  detectGlobalPackageManager,
  formatGlobalCommand,
  getGlobalInstallCommand,
  type GlobalPackageManagerName,
} from "./global-package-manager";

const LATEST_TAG = "latest";
const UPDATE_COMMAND = "ajs update";

export async function warnIfOutdated(
  currentVersion: string,
  exec: (
    command: string,
    options: ExecSyncOptions,
  ) => Buffer | string = execSync,
  packageManager: GlobalPackageManagerName = detectGlobalPackageManager(),
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
            `${CORE_PACKAGE_NAME}@${LATEST_TAG}`,
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
