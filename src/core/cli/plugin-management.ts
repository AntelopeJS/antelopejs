import chalk from "chalk";

import { CORE_PACKAGE_NAME } from "./core-version";
import { runGlobalInstall } from "./command-runner";
import { consoleOutput, type CommandOutput } from "./cli-ui";
import type { InheritedProcessOptions } from "./process-runner";
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE } from "./exit-codes";
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
import {
  LOCAL_EXECUTABLE_SOURCE,
  PATH_EXECUTABLE_SOURCE,
  resolveExecutable,
  type ExecutableLookup,
  type ExecutableSource,
} from "./executable-lookup";

export interface PluginStatus {
  plugin: OfficialPlugin;
  executablePath?: string;
  source?: ExecutableSource;
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
  const lookupExecutable = dependencies.lookupExecutable ?? resolveExecutable;
  const executable = await lookupExecutable(plugin.bin);
  if (!executable) {
    return { plugin };
  }
  const packageJson = await resolvePluginPackage(
    plugin.package,
    executable,
    dependencies.packageLookup,
  );
  return {
    plugin,
    executablePath: executable.path,
    source: executable.source,
    version: packageJson?.version,
  };
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

const RESOLUTION_LABELS: Record<ExecutableSource, (path: string) => string> = {
  [LOCAL_EXECUTABLE_SOURCE]: (path) => `local (${path})`,
  [PATH_EXECUTABLE_SOURCE]: () => "global",
};

function formatResolution(status: PluginStatus): string {
  if (!status.executablePath || !status.source) {
    return chalk.dim("not installed");
  }
  const version = status.version ? ` (${status.version})` : "";
  return chalk.green(
    `${RESOLUTION_LABELS[status.source](status.executablePath)}${version}`,
  );
}

export function formatPluginStatus(status: PluginStatus): string {
  return `  ${chalk.cyan(status.plugin.name.padEnd(PLUGIN_NAME_COLUMN_WIDTH))} ${status.plugin.package} - ${formatResolution(status)}\n    ${chalk.dim(status.plugin.description)}`;
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
        .filter((status) => status.source === PATH_EXECUTABLE_SOURCE)
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
