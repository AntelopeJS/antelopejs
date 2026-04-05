import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { warning } from "./cli/cli-ui";
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

export async function fetchLatestVersion(
  packageName: string,
): Promise<string | undefined> {
  try {
    const result = await ExecuteCMD(
      `${NPM_VIEW_COMMAND} ${packageName} ${VERSION_ARGUMENT}`,
      {},
    );
    return parsePackageInfoOutput(result.stdout);
  } catch {
    return undefined;
  }
}

export async function checkOutdatedModules(
  modules: Record<string, ExpandedModuleConfig>,
): Promise<OutdatedModule[]> {
  const packageModules = Object.entries(modules).filter(
    ([, info]) => info.source?.type === "package",
  );

  const results = await Promise.allSettled(
    packageModules.map(([, info]) =>
      fetchLatestVersion((info.source as ModuleSourcePackage).package),
    ),
  );

  return packageModules.reduce<OutdatedModule[]>(
    (outdated, [name, info], index) => {
      const result = results[index];
      if (result.status !== "fulfilled" || !result.value) {
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
