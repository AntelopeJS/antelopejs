import chalk from "chalk";

import { CORE_PACKAGE_NAME } from "./core-version";
import { runGlobalInstall } from "./command-runner";
import { consoleOutput, type CommandOutput } from "./cli-ui";
import type { InheritedProcessOptions } from "./process-runner";
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE } from "./exit-codes";
import { findExecutable, type ExecutableLookup } from "./executable-lookup";
import {
  resolvePluginPackage,
  type PluginPackageLookup,
} from "./plugin-package";
import {
  findOfficialPlugin,
  listOfficialPlugins,
  officialPluginNames,
  PLUGIN_NAME_COLUMN_WIDTH,
  type OfficialPlugin,
} from "./plugin-registry";
import {
  detectGlobalInstallation,
  getLatestPackageSpec,
  type GlobalInstallation,
  type GlobalInstallationDetector,
} from "./global-package-manager";

export interface PluginStatus {
  plugin: OfficialPlugin;
  executablePath?: string;
  version?: string;
}

export interface PluginStatusDependencies {
  lookupExecutable?: ExecutableLookup;
  packageLookup?: PluginPackageLookup;
}

export interface PluginManagementDependencies extends PluginStatusDependencies {
  processOptions?: InheritedProcessOptions;
  detectInstallation?: GlobalInstallationDetector;
  output?: CommandOutput;
}

const NOT_GLOBAL_MESSAGES = [
  "ajs is not installed globally; update it in the project instead.",
  `Run your project package manager to update ${CORE_PACKAGE_NAME} in this project.`,
];

async function readPluginStatus(
  plugin: OfficialPlugin,
  dependencies: PluginStatusDependencies,
): Promise<PluginStatus> {
  const lookupExecutable = dependencies.lookupExecutable ?? findExecutable;
  const executablePath = await lookupExecutable(plugin.bin);
  if (!executablePath) {
    return { plugin };
  }
  const packageJson = await resolvePluginPackage(
    plugin.package,
    executablePath,
    dependencies.packageLookup,
  );
  return { plugin, executablePath, version: packageJson?.version };
}

export async function getPluginStatuses(
  dependencies: PluginStatusDependencies = {},
): Promise<PluginStatus[]> {
  return Promise.all(
    listOfficialPlugins().map((plugin) =>
      readPluginStatus(plugin, dependencies),
    ),
  );
}

export function formatPluginStatus(status: PluginStatus): string {
  const state = status.executablePath
    ? chalk.green(`installed${status.version ? ` (${status.version})` : ""}`)
    : chalk.dim("not installed");
  return `  ${chalk.cyan(status.plugin.name.padEnd(PLUGIN_NAME_COLUMN_WIDTH))} ${status.plugin.package} - ${state}\n    ${chalk.dim(status.plugin.description)}`;
}

async function updatePackage(
  packageName: string,
  installation: GlobalInstallation,
  dependencies: PluginManagementDependencies,
): Promise<number> {
  const output = dependencies.output ?? consoleOutput;
  const execution = await runGlobalInstall({
    packageSpec: getLatestPackageSpec(packageName),
    packageManager: installation.packageManager,
    output,
    processOptions: dependencies.processOptions,
  });
  if (execution.exitCode !== SUCCESS_EXIT_CODE) {
    output.error(`Update failed: ${execution.command}`);
  }
  return execution.exitCode;
}

async function resolveUpdateTargets(
  pluginName: string | undefined,
  dependencies: PluginManagementDependencies,
): Promise<string[] | undefined> {
  if (!pluginName) {
    const statuses = await getPluginStatuses(dependencies);
    return [
      CORE_PACKAGE_NAME,
      ...statuses
        .filter((status) => status.executablePath)
        .map((status) => status.plugin.package),
    ];
  }
  const plugin = findOfficialPlugin(pluginName);
  if (plugin) {
    return [plugin.package];
  }
  const output = dependencies.output ?? consoleOutput;
  output.error(
    `Unknown plugin "${pluginName}". Known plugins: ${officialPluginNames().join(", ")}.`,
  );
  return undefined;
}

export async function runUpdate(
  pluginName: string | undefined,
  dependencies: PluginManagementDependencies = {},
): Promise<number> {
  const output = dependencies.output ?? consoleOutput;
  const detectInstallation =
    dependencies.detectInstallation ?? (() => detectGlobalInstallation());
  const installation = detectInstallation();
  if (!installation) {
    NOT_GLOBAL_MESSAGES.forEach((message) => output.error(message));
    return FAILURE_EXIT_CODE;
  }

  const targets = await resolveUpdateTargets(pluginName, dependencies);
  if (!targets) {
    return FAILURE_EXIT_CODE;
  }
  for (const target of targets) {
    const exitCode = await updatePackage(target, installation, dependencies);
    if (exitCode !== SUCCESS_EXIT_CODE) {
      return exitCode;
    }
  }
  return SUCCESS_EXIT_CODE;
}
