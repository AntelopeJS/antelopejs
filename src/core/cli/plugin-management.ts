import chalk from "chalk";

import { CORE_PACKAGE_NAME } from "./core-version";
import { consoleOutput, type CommandOutput } from "./cli-ui";
import { findExecutable, type ExecutableLookup } from "./executable-lookup";
import { readPluginPackage, type PluginPackageLookup } from "./plugin-package";
import {
  nodeProcessRunner,
  runInheritedProcess,
  type ProcessRunner,
} from "./process-runner";
import {
  findOfficialPlugin,
  listOfficialPlugins,
  officialPluginNames,
  type OfficialPlugin,
} from "./plugin-registry";
import {
  detectGlobalPackageManager,
  formatGlobalCommand,
  getGlobalInstallCommand,
  type GlobalPackageManagerName,
} from "./global-package-manager";

const LATEST_TAG = "latest";
const SUCCESS_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;

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
  processRunner?: ProcessRunner;
  packageManager?: GlobalPackageManagerName;
  output?: CommandOutput;
}

async function readPluginStatus(
  plugin: OfficialPlugin,
  dependencies: PluginStatusDependencies,
): Promise<PluginStatus> {
  const lookupExecutable = dependencies.lookupExecutable ?? findExecutable;
  const executablePath = await lookupExecutable(plugin.bin);
  if (!executablePath) {
    return { plugin };
  }
  const packageJson = await readPluginPackage(executablePath, {
    ...dependencies.packageLookup,
    expectedName: plugin.package,
  });
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
  return `  ${chalk.cyan(status.plugin.name.padEnd(10))} ${status.plugin.package} - ${state}\n    ${chalk.dim(status.plugin.description)}`;
}

async function runGlobalInstall(
  packageName: string,
  dependencies: PluginManagementDependencies,
): Promise<number> {
  const output = dependencies.output ?? consoleOutput;
  const command = getGlobalInstallCommand(
    `${packageName}@${LATEST_TAG}`,
    dependencies.packageManager ?? detectGlobalPackageManager(),
  );
  const formatted = formatGlobalCommand(command);
  output.info(`Running: ${formatted}`);
  const exitCode = await runInheritedProcess(
    command.executable,
    command.args,
    dependencies.processRunner ?? nodeProcessRunner,
  );
  if (exitCode !== SUCCESS_EXIT_CODE) {
    output.error(`Update failed: ${formatted}`);
  }
  return exitCode;
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
  const targets = await resolveUpdateTargets(pluginName, dependencies);
  if (!targets) {
    return FAILURE_EXIT_CODE;
  }
  for (const target of targets) {
    const exitCode = await runGlobalInstall(target, dependencies);
    if (exitCode !== SUCCESS_EXIT_CODE) {
      return exitCode;
    }
  }
  return SUCCESS_EXIT_CODE;
}
