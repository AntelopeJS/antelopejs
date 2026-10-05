import { satisfies, validRange } from "semver";
import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";

import { ExecError, ExecuteCMD } from "./cli/command";
import { warning } from "./cli/cli-ui";
import {
  CliError,
  describeFailure,
  getProcessTasks,
  getProcessUi,
  pluralize,
  truncate,
} from "./cli/output";
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
  throw new CliError({
    title: `'${spec}' is neither a valid semver range nor a dist-tag of '${packageName}'`,
  });
}

export async function fetchLatestVersion(packageName: string): Promise<string> {
  const command = `${NPM_VIEW_COMMAND} ${packageName} ${VERSION_ARGUMENT}`;
  const result = await ExecuteCMD(command, {});
  if (result.code !== 0) {
    throw new ExecError({ ...result, command });
  }
  return parsePackageInfoOutput(result.stdout);
}

function whenAborted(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * Looks up the latest version of every package as one transient task: its
 * line disappears once the registry answered, the results speak for it.
 * Aborting `signal` stops waiting for the lookups still running.
 */
async function fetchLatestVersions(
  packageNames: string[],
  signal?: AbortSignal,
): Promise<PromiseSettledResult<string>[]> {
  const task = getProcessTasks().start(
    `Checking ${pluralize(packageNames.length, "module")} on npm`,
  );
  const slowWarning = setTimeout(() => {
    warning(
      "Module version check is taking longer than expected: the npm registry may be slow or unreachable. " +
        "Set NPM_CONFIG_FETCH_RETRIES=0 to fail fast.",
    );
  }, SLOW_CHECK_THRESHOLD_MS);
  try {
    return await Promise.race([
      Promise.allSettled(packageNames.map(fetchLatestVersion)),
      whenAborted(signal).then(() => []),
    ]);
  } finally {
    clearTimeout(slowWarning);
    task.dismiss();
  }
}

type ModuleEntry = [string, ExpandedModuleConfig];

function packageSourceOf(info: ExpandedModuleConfig): ModuleSourcePackage {
  return info.source as ModuleSourcePackage;
}

function warnUncheckedPackage(packageName: string, reason: unknown): void {
  const truncated = truncate(
    describeFailure(reason, false).title,
    MAX_REASON_LENGTH,
    getProcessUi().symbols.ellipsis,
  );
  warning(`Could not check latest version of ${packageName}: ${truncated}`);
}

function collectOutdatedModules(
  packageModules: ModuleEntry[],
  results: PromiseSettledResult<string>[],
): OutdatedModule[] {
  return packageModules.reduce<OutdatedModule[]>(
    (outdated, [name, info], index) => {
      const result = results[index];
      const source = packageSourceOf(info);
      if (result.status === "rejected") {
        warnUncheckedPackage(source.package, result.reason);
        return outdated;
      }
      if (result.value && !isUpToDate(source.version, result.value)) {
        outdated.push({ name, current: source.version, latest: result.value });
      }
      return outdated;
    },
    [],
  );
}

/**
 * The package modules whose latest version on npm is outside of the range
 * they are configured with. Aborting `signal` cancels the check: it returns
 * at once, without waiting for the registry, and finds nothing outdated.
 */
export async function checkOutdatedModules(
  modules: Record<string, ExpandedModuleConfig>,
  signal?: AbortSignal,
): Promise<OutdatedModule[]> {
  const packageModules = Object.entries(modules).filter(
    ([, info]) => info.source?.type === "package",
  );
  if (packageModules.length === 0 || signal?.aborted) {
    return [];
  }

  const results = await fetchLatestVersions(
    packageModules.map(([, info]) => packageSourceOf(info).package),
    signal,
  );
  return signal?.aborted ? [] : collectOutdatedModules(packageModules, results);
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
