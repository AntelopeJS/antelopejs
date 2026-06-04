import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { info as infoMessage, warning } from "./cli/cli-ui";
import { ExecuteCMD } from "./cli/command";
import { parsePackageInfoOutput } from "./cli/package-manager";
import type { ExpandedModuleConfig } from "./config/config-parser";

export interface OutdatedModule {
  name: string;
  current: string;
  latest: string;
}

const NPM_VIEW_COMMAND = "npm view";
const VERSION_ARGUMENT = "version";
const UPDATE_COMMAND = "ajs project modules update";
const SLOW_CHECK_THRESHOLD_MS = 15_000;
const MAX_REASON_LENGTH = 200;

export async function fetchLatestVersion(packageName: string): Promise<string> {
  const result = await ExecuteCMD(
    `${NPM_VIEW_COMMAND} ${packageName} ${VERSION_ARGUMENT}`,
    {},
  );
  return parsePackageInfoOutput(result.stdout);
}

export async function checkOutdatedModules(
  modules: Record<string, ExpandedModuleConfig>,
): Promise<OutdatedModule[]> {
  const packageModules = Object.entries(modules).filter(
    ([, info]) => info.source?.type === "package",
  );

  if (packageModules.length === 0) {
    return [];
  }

  infoMessage("Checking for module updates...");

  const slowWarning = setTimeout(() => {
    warning(
      "Module version check is taking longer than expected — the npm registry may be slow or unreachable. " +
        "Set NPM_CONFIG_FETCH_RETRIES=0 to fail fast.",
    );
  }, SLOW_CHECK_THRESHOLD_MS);

  let results: PromiseSettledResult<string>[];
  try {
    results = await Promise.allSettled(
      packageModules.map(([, info]) =>
        fetchLatestVersion((info.source as ModuleSourcePackage).package),
      ),
    );
  } finally {
    clearTimeout(slowWarning);
  }

  return packageModules.reduce<OutdatedModule[]>(
    (outdated, [name, info], index) => {
      const result = results[index];
      const packageName = (info.source as ModuleSourcePackage).package;
      if (result.status === "rejected") {
        const reason = String(result.reason ?? "unknown error");
        const truncated =
          reason.length > MAX_REASON_LENGTH
            ? `${reason.slice(0, MAX_REASON_LENGTH)}…`
            : reason;
        warning(
          `Could not check latest version of ${packageName}: ${truncated}`,
        );
        return outdated;
      }
      if (!result.value) {
        return outdated;
      }
      const current = (info.source as ModuleSourcePackage).version;
      const latest = result.value;
      if (current !== latest) {
        outdated.push({ name, current, latest });
      }
      return outdated;
    },
    [],
  );
}

export function warnOutdatedModules(outdated: OutdatedModule[]): void {
  if (outdated.length === 0) {
    return;
  }
  warning(
    `${outdated.length} module(s) have updates available.` +
      ` Run '${UPDATE_COMMAND}' to upgrade.`,
  );
}
