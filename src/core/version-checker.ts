import { satisfies, validRange } from "semver";
import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";

import { ExecError, ExecuteCMD } from "./cli/command";
import { describeFailure } from "./cli/output";
import { info as infoMessage, warning } from "./cli/cli-ui";
import { parsePackageInfoOutput } from "./cli/package-manager";
import type { ExpandedModuleConfig } from "./config/config-parser";

export interface OutdatedModule {
  name: string;
  current: string;
  latest: string;
}

const NPM_VIEW_COMMAND = "npm view";
const VERSION_ARGUMENT = "version";
const DIST_TAGS_ARGUMENT = "dist-tags --json";
const CARET_PREFIX = "^";
const UPDATE_COMMAND = "ajs project modules update";
const SLOW_CHECK_THRESHOLD_MS = 15_000;
const MAX_REASON_LENGTH = 200;

const RANGE_PREFIX_PATTERN = /^[\^~]/;

export function isUpToDate(currentSpec: string, latest: string): boolean {
  if (currentSpec === latest) {
    return true;
  }
  const range = validRange(currentSpec);
  if (range === null) {
    return true;
  }
  return satisfies(latest, range);
}

export function bumpVersionSpec(currentSpec: string, latest: string): string {
  const prefix = currentSpec.match(RANGE_PREFIX_PATTERN)?.[0] ?? "";
  return `${prefix}${latest}`;
}

export function toFloatingSpec(version: string): string {
  return `${CARET_PREFIX}${version}`;
}

export async function fetchDistTags(
  packageName: string,
): Promise<Record<string, string>> {
  const command = `${NPM_VIEW_COMMAND} ${packageName} ${DIST_TAGS_ARGUMENT}`;
  const result = await ExecuteCMD(command, {});
  if (result.code !== 0) {
    throw new ExecError({ ...result, command });
  }
  return JSON.parse(result.stdout) as Record<string, string>;
}

export async function validateVersionSpec(
  packageName: string,
  spec: string,
): Promise<void> {
  if (validRange(spec) !== null) {
    return;
  }
  const distTags = await fetchDistTags(packageName);
  if (spec in distTags) {
    return;
  }
  throw new Error(
    `'${spec}' is neither a valid semver range nor a dist-tag of '${packageName}'`,
  );
}

export async function fetchLatestVersion(packageName: string): Promise<string> {
  const command = `${NPM_VIEW_COMMAND} ${packageName} ${VERSION_ARGUMENT}`;
  const result = await ExecuteCMD(command, {});
  if (result.code !== 0) {
    throw new ExecError({ ...result, command });
  }
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
        const reason = describeFailure(result.reason, false).title;
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
      if (!isUpToDate(current, latest)) {
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
