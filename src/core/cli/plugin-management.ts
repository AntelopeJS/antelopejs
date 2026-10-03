import { CORE_PACKAGE_NAME, getCoreVersion } from "./core-version";
import { runGlobalInstall } from "./command-runner";
import { consoleOutput, type CommandOutput } from "./cli-ui";
import type { InheritedProcessOptions } from "./process-runner";
import {
  FAILURE_EXIT_CODE,
  SUCCESS_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "./exit-codes";
import {
  displayPath,
  getProcessPalette,
  type CliProblem,
  type TableColumn,
  type Ui,
} from "./output";
import {
  evaluatePluginCompatibility,
  type PluginCompatibility,
} from "./plugin-compatibility";
import {
  resolvePluginPackage,
  type PluginPackageLookup,
} from "./plugin-package";
import {
  findOfficialPlugin,
  listOfficialPlugins,
  officialPluginNames,
  type OfficialPlugin,
} from "./plugin-registry";
import {
  detectGlobalInstallation,
  formatGlobalCommand,
  getGlobalInstallCommand,
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
  compatibility?: PluginCompatibility;
}

type PluginState = "not-installed" | PluginCompatibility["status"];

export interface PluginReport {
  name: string;
  package: string;
  description: string;
  state: PluginState;
  source: string | null;
  path: string | null;
  version: string | null;
  requiredCoreRange: string | null;
}

export interface PluginStatusDependencies {
  lookupExecutable?: ExecutableLookup;
  packageLookup?: PluginPackageLookup;
  coreVersion?: string;
}

export interface PluginManagementDependencies extends PluginStatusDependencies {
  processOptions?: InheritedProcessOptions;
  detectInstallation?: GlobalInstallationDetector;
  output?: CommandOutput;
}

type PluginInstallCommand = (packageName: string) => string;

type PluginHint = (
  report: PluginReport,
  installCommand: PluginInstallCommand,
) => string | undefined;

const PLUGINS_COMMAND = "ajs plugins";

const NOT_GLOBAL_PROBLEM: CliProblem = {
  title: "ajs is not installed globally",
  reason:
    "ajs update only updates a CLI installed globally with npm, pnpm or Yarn; this one comes from a project dependency or a source checkout.",
  fixes: [
    `Update ${CORE_PACKAGE_NAME} in the project with its package manager instead`,
  ],
};

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
    compatibility: evaluatePluginCompatibility(
      packageJson,
      dependencies.coreVersion ?? getCoreVersion(),
    ),
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

const MISSING_VALUE = "-";
const UPDATE_COMMAND = "ajs update";

const SOURCE_LABELS: Record<ExecutableSource, string> = {
  [LOCAL_EXECUTABLE_SOURCE]: "local",
  [PATH_EXECUTABLE_SOURCE]: "global",
};

const STATE_LABELS: Record<PluginState, (report: PluginReport) => string> = {
  "not-installed": () => "not installed",
  compatible: () => "compatible",
  unknown: () => "unknown",
  incompatible: (report) =>
    `needs ${CORE_PACKAGE_NAME} ${report.requiredCoreRange}`,
};

const UPDATE_HINTS: Record<string, (report: PluginReport) => string> = {
  [SOURCE_LABELS[LOCAL_EXECUTABLE_SOURCE]]: (report) =>
    `Update ${report.package} in this project's package.json`,
  [SOURCE_LABELS[PATH_EXECUTABLE_SOURCE]]: (report) =>
    `Run ${UPDATE_COMMAND} ${report.name} to update ${report.name}`,
};

const PLUGIN_COLUMNS: TableColumn<PluginReport>[] = [
  { header: "Plugin", value: (report) => report.name },
  { header: "Package", value: (report) => report.package },
  { header: "Version", value: (report) => report.version ?? MISSING_VALUE },
  { header: "Source", value: (report) => report.source ?? MISSING_VALUE },
  { header: "Status", value: (report) => STATE_LABELS[report.state](report) },
  {
    header: "Location",
    value: (report) => (report.path ? displayPath(report.path) : MISSING_VALUE),
  },
];

function requiredCoreRange(status: PluginStatus): string | null {
  return status.compatibility?.status === "incompatible"
    ? status.compatibility.requiredRange
    : null;
}

export function describePluginStatus(status: PluginStatus): PluginReport {
  return {
    name: status.plugin.name,
    package: status.plugin.package,
    description: status.plugin.description,
    state: status.compatibility?.status ?? "not-installed",
    source: status.source ? SOURCE_LABELS[status.source] : null,
    path: status.executablePath ?? null,
    version: status.version ?? null,
    requiredCoreRange: requiredCoreRange(status),
  };
}

const PLUGIN_HINTS: Partial<Record<PluginState, PluginHint>> = {
  "not-installed": (report, installCommand) =>
    `Run ${installCommand(report.package)} to install ${report.name}`,
  incompatible: (report) =>
    report.source ? UPDATE_HINTS[report.source](report) : undefined,
};

function globalInstallCommand(packageName: string): string {
  return formatGlobalCommand(getGlobalInstallCommand(packageName));
}

/**
 * Renders official plugins as a table on stdout, with a hint on stderr for
 * each plugin that is not installed (the command that installs it) or does
 * not support the running core (how to update it).
 */
export function renderPluginReports(
  reports: PluginReport[],
  ui: Ui,
  installCommand: PluginInstallCommand = globalInstallCommand,
): void {
  ui.table(reports, PLUGIN_COLUMNS);
  reports
    .map((report) => PLUGIN_HINTS[report.state]?.(report, installCommand))
    .filter((hint): hint is string => hint !== undefined)
    .forEach((hint) => ui.message("hint", hint));
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

async function listGlobalUpdateTargets(
  dependencies: PluginManagementDependencies,
): Promise<string[]> {
  const statuses = await getPluginStatuses(dependencies);
  return [
    CORE_PACKAGE_NAME,
    ...statuses
      .filter((status) => status.source === PATH_EXECUTABLE_SOURCE)
      .map((status) => status.plugin.package),
  ];
}

function describeUnknownPlugin(pluginName: string): CliProblem {
  return {
    title: `Unknown plugin '${pluginName}'`,
    reason: `Official plugins: ${officialPluginNames().join(", ")}.`,
    fixes: [`Run ${getProcessPalette().cyan(PLUGINS_COMMAND)} to list them`],
    exitCode: USAGE_EXIT_CODE,
  };
}

async function updateTargets(
  targets: string[],
  installation: GlobalInstallation,
  dependencies: PluginManagementDependencies,
): Promise<number> {
  for (const target of targets) {
    const exitCode = await updatePackage(target, installation, dependencies);
    if (exitCode !== SUCCESS_EXIT_CODE) {
      return exitCode;
    }
  }
  return SUCCESS_EXIT_CODE;
}

/**
 * Updates the global CLI and its globally installed official plugins, or a
 * single official plugin by name. An unknown plugin name is rejected with
 * the usage exit code before anything else is checked.
 */
export async function runUpdate(
  pluginName: string | undefined,
  dependencies: PluginManagementDependencies = {},
): Promise<number> {
  const output = dependencies.output ?? consoleOutput;
  const plugin = pluginName ? findOfficialPlugin(pluginName) : undefined;
  if (pluginName && !plugin) {
    output.problem(describeUnknownPlugin(pluginName));
    return USAGE_EXIT_CODE;
  }
  const detectInstallation =
    dependencies.detectInstallation ?? (() => detectGlobalInstallation());
  const installation = detectInstallation();
  if (!installation) {
    output.problem(NOT_GLOBAL_PROBLEM);
    return FAILURE_EXIT_CODE;
  }
  const targets = plugin
    ? [plugin.package]
    : await listGlobalUpdateTargets(dependencies);
  return updateTargets(targets, installation, dependencies);
}
