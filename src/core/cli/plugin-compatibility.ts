import chalk from "chalk";
import semver from "semver";

import { CORE_PACKAGE_NAME } from "./core-version";
import type { ResolvedExecutable } from "./executable-lookup";
import { type OfficialPlugin, officialPluginLabel } from "./plugin-registry";
import {
  resolvePluginPackage,
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

function formatUnknownPackageMessage(plugin: OfficialPlugin): string {
  return `Could not read the package.json of ${plugin.package}; skipping the compatibility check.`;
}

function formatIncompatibilityMessages(
  plugin: OfficialPlugin,
  coreVersion: string,
  compatibility: IncompatiblePluginResult,
): string[] {
  const pluginVersion = compatibility.pluginVersion
    ? `${plugin.package}@${compatibility.pluginVersion}`
    : plugin.package;
  return [
    `The ${officialPluginLabel(plugin)} plugin is not compatible with this CLI.`,
    `${pluginVersion} requires ${CORE_PACKAGE_NAME}@${compatibility.requiredRange}, but ${CORE_PACKAGE_NAME}@${coreVersion} is installed.`,
    `Run ${chalk.cyan("ajs update")} to update both, or ${chalk.cyan(`ajs update ${plugin.name}`)} to update the plugin only.`,
  ];
}

export interface CompatibilityReport {
  canDelegate: boolean;
  messages: string[];
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
  compatible: () => ({ canDelegate: true, messages: [] }),
  unknown: (plugin) => ({
    canDelegate: true,
    messages: [formatUnknownPackageMessage(plugin)],
  }),
  incompatible: (plugin, coreVersion, compatibility) =>
    compatibility.status === "incompatible"
      ? {
          canDelegate: false,
          messages: formatIncompatibilityMessages(
            plugin,
            coreVersion,
            compatibility,
          ),
        }
      : { canDelegate: true, messages: [] },
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
