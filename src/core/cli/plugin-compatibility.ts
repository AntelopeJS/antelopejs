import semver from "semver";

import { getProcessPalette, type CliProblem } from "./output";
import { CORE_PACKAGE_NAME } from "./core-version";
import type { ResolvedExecutable } from "./executable-lookup";
import { type OfficialPlugin, officialPluginLabel } from "./plugin-registry";
import {
  resolvePluginPackage,
  type PluginPackage,
  type PluginPackageLookup,
} from "./plugin-package";

interface CompatiblePluginResult {
  status: "compatible";
}

interface UnknownPluginPackageResult {
  status: "unknown";
}

interface IncompatiblePluginResult {
  status: "incompatible";
  requiredRange: string;
  pluginVersion?: string;
}

export type PluginCompatibility =
  | CompatiblePluginResult
  | UnknownPluginPackageResult
  | IncompatiblePluginResult;

/**
 * Whether a plugin, described by the `package.json` of its resolved
 * executable, supports the running core: its `peerDependencies` range on the
 * core must include `coreVersion`. A plugin without that range supports every
 * core, and an unreadable `package.json` gives an `unknown` result.
 */
export function evaluatePluginCompatibility(
  packageJson: PluginPackage | undefined,
  coreVersion: string,
): PluginCompatibility {
  if (!packageJson) {
    return { status: "unknown" };
  }
  const requiredRange = packageJson.peerDependencies?.[CORE_PACKAGE_NAME];
  if (
    !requiredRange ||
    semver.satisfies(coreVersion, requiredRange, { includePrerelease: true })
  ) {
    return { status: "compatible" };
  }
  return {
    status: "incompatible",
    requiredRange,
    pluginVersion: packageJson.version,
  };
}

export async function checkPluginCompatibility(
  executable: ResolvedExecutable,
  coreVersion: string,
  plugin: OfficialPlugin,
  lookup: PluginPackageLookup = {},
): Promise<PluginCompatibility> {
  const packageJson = await resolvePluginPackage(
    plugin.package,
    executable,
    lookup,
  );
  return evaluatePluginCompatibility(packageJson, coreVersion);
}

function formatUnknownPackageWarning(plugin: OfficialPlugin): string {
  return `Could not read the package.json of ${plugin.package}; skipping the compatibility check`;
}

function describeIncompatibility(
  plugin: OfficialPlugin,
  coreVersion: string,
  compatibility: IncompatiblePluginResult,
): CliProblem {
  const pluginVersion = compatibility.pluginVersion
    ? `${plugin.package}@${compatibility.pluginVersion}`
    : plugin.package;
  const palette = getProcessPalette();
  return {
    title: `The ${officialPluginLabel(plugin)} plugin is not compatible with this CLI`,
    reason: `${pluginVersion} requires ${CORE_PACKAGE_NAME}@${compatibility.requiredRange}, but ${CORE_PACKAGE_NAME}@${coreVersion} is installed.`,
    fixes: [
      `Run ${palette.cyan("ajs update")} to update both, or ${palette.cyan(`ajs update ${plugin.name}`)} to update the plugin only`,
    ],
  };
}

/**
 * What delegation does with a compatibility result: whether the plugin may
 * run, a warning to print when it runs anyway, or the problem that stops it.
 */
export interface CompatibilityReport {
  canDelegate: boolean;
  warning?: string;
  problem?: CliProblem;
}

type CompatibilityReporter = (
  plugin: OfficialPlugin,
  coreVersion: string,
  compatibility: PluginCompatibility,
) => CompatibilityReport;

const COMPATIBILITY_REPORTERS: Record<
  PluginCompatibility["status"],
  CompatibilityReporter
> = {
  compatible: () => ({ canDelegate: true }),
  unknown: (plugin) => ({
    canDelegate: true,
    warning: formatUnknownPackageWarning(plugin),
  }),
  incompatible: (plugin, coreVersion, compatibility) =>
    compatibility.status === "incompatible"
      ? {
          canDelegate: false,
          problem: describeIncompatibility(plugin, coreVersion, compatibility),
        }
      : { canDelegate: true },
};

export function reportCompatibility(
  plugin: OfficialPlugin,
  coreVersion: string,
  compatibility: PluginCompatibility,
): CompatibilityReport {
  return COMPATIBILITY_REPORTERS[compatibility.status](
    plugin,
    coreVersion,
    compatibility,
  );
}
