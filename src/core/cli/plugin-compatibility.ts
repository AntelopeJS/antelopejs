import chalk from "chalk";
import semver from "semver";

import { CORE_PACKAGE_NAME } from "./core-version";
import { type OfficialPlugin, officialPluginLabel } from "./plugin-registry";
import { readPluginPackage, type PluginPackageLookup } from "./plugin-package";

export interface PluginCompatibility {
  isCompatible: boolean;
  requiredRange?: string;
  pluginVersion?: string;
}

export async function checkPluginCompatibility(
  executablePath: string,
  coreVersion: string,
  plugin: OfficialPlugin,
  lookup: PluginPackageLookup = {},
): Promise<PluginCompatibility> {
  const packageJson = await readPluginPackage(executablePath, {
    ...lookup,
    expectedName: lookup.expectedName ?? plugin.package,
  });
  const requiredRange = packageJson?.peerDependencies?.[CORE_PACKAGE_NAME];
  if (!requiredRange) {
    return { isCompatible: true, pluginVersion: packageJson?.version };
  }
  return {
    isCompatible: semver.satisfies(coreVersion, requiredRange, {
      includePrerelease: true,
    }),
    requiredRange,
    pluginVersion: packageJson?.version,
  };
}

export function formatIncompatibilityMessages(
  plugin: OfficialPlugin,
  coreVersion: string,
  compatibility: PluginCompatibility,
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
