import { CORE_PACKAGE_NAME, getCoreVersion } from "./core-version";
import { runGlobalInstall } from "./command-runner";
import { consoleOutput, type CommandOutput } from "./cli-ui";
import type { InheritedProcessOptions } from "./process-runner";
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE } from "./exit-codes";
import { displayPath, type TableColumn, type Ui } from "./output";
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

/**
 * Renders official plugins as a table on stdout, with a hint on stderr for
 * each plugin that does not support the running core.
 */
export function renderPluginReports(reports: PluginReport[], ui: Ui): void {
  ui.table(reports, PLUGIN_COLUMNS);
  reports
    .filter((report) => report.state === "incompatible" && report.source)
    .forEach((report) =>
      ui.message("hint", UPDATE_HINTS[report.source as string](report)),
    );
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
