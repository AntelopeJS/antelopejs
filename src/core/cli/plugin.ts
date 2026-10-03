import { getCoreVersion } from "./core-version";
import {
  createPrompter,
  displayPath,
  getProcessPalette,
  promptEnvironment,
  type CliProblem,
} from "./output";
import type { PluginPackageLookup } from "./plugin-package";
import { consoleOutput, type CommandOutput } from "./cli-ui";
import type { InheritedProcessOptions } from "./process-runner";
import {
  parsePluginInvocation,
  type PluginInvocation,
} from "./plugin-arguments";
import { runCommand, runGlobalInstall } from "./command-runner";
import type { PackageManagerName } from "./package-manager-name";
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE } from "./exit-codes";
import {
  checkPluginCompatibility,
  reportCompatibility,
} from "./plugin-compatibility";
import {
  findOfficialPlugin,
  officialPluginLabel,
  type OfficialPlugin,
} from "./plugin-registry";
import {
  resolveExecutable,
  type ExecutableLookup,
  type ResolvedExecutable,
} from "./executable-lookup";
import {
  detectGlobalPackageManager,
  formatGlobalCommand,
  getGlobalInstallCommand,
} from "./global-package-manager";

const PLUGIN_PREFIX = "ajs-";
const PLUGIN_INSTALL_COMMAND = "ajs";

type PluginInstallPrompt = (message: string) => Promise<boolean>;

interface DelegatedPluginResult {
  isDelegated: true;
  exitCode: number;
}

interface UndelegatedPluginResult {
  isDelegated: false;
}

export type PluginDelegationResult =
  | DelegatedPluginResult
  | UndelegatedPluginResult;

export interface PluginDelegationDependencies {
  processOptions?: InheritedProcessOptions;
  lookupExecutable?: ExecutableLookup;
  packageLookup?: PluginPackageLookup;
  confirmInstall?: PluginInstallPrompt;
  isInteractive?: () => boolean;
  coreVersion?: string;
  packageManager?: PackageManagerName;
  output?: CommandOutput;
}

type DelegationContext = Required<PluginDelegationDependencies>;

const NOT_DELEGATED: UndelegatedPluginResult = { isDelegated: false };

function pluginBinary(command: string): string {
  return `${PLUGIN_PREFIX}${command}`;
}

function promptForInstall(message: string): Promise<boolean> {
  return createPrompter({ command: PLUGIN_INSTALL_COMMAND }).confirm({
    message,
    defaultAnswer: false,
  });
}

function createContext(
  dependencies: PluginDelegationDependencies,
): DelegationContext {
  const packageManager =
    dependencies.packageManager ?? detectGlobalPackageManager();
  return {
    processOptions: dependencies.processOptions ?? {},
    lookupExecutable: dependencies.lookupExecutable ?? resolveExecutable,
    packageLookup: dependencies.packageLookup ?? { packageManager },
    confirmInstall: dependencies.confirmInstall ?? promptForInstall,
    isInteractive:
      dependencies.isInteractive ?? (() => promptEnvironment.isInteractive()),
    coreVersion: dependencies.coreVersion ?? getCoreVersion(),
    packageManager,
    output: dependencies.output ?? consoleOutput,
  };
}

function delegated(exitCode: number): DelegatedPluginResult {
  return { isDelegated: true, exitCode };
}

function formatInstallCommand(
  plugin: OfficialPlugin,
  context: DelegationContext,
): string {
  return formatGlobalCommand(
    getGlobalInstallCommand(
      plugin.package,
      context.packageManager,
      context.processOptions.platform,
    ),
  );
}

function describeMissingPlugin(
  plugin: OfficialPlugin,
  context: DelegationContext,
): CliProblem {
  return {
    title: `The ${officialPluginLabel(plugin)} plugin is not installed`,
    reason: `Official plugins are separate packages (${plugin.package}).`,
    fixes: [
      `Install it: ${getProcessPalette().cyan(formatInstallCommand(plugin, context))}, or add it to your project's dependencies`,
    ],
  };
}

async function confirmPluginInstall(
  plugin: OfficialPlugin,
  context: DelegationContext,
): Promise<boolean> {
  if (!context.isInteractive()) {
    return false;
  }
  return context.confirmInstall(
    `The ${officialPluginLabel(plugin)} plugin is not installed. Install ${plugin.package} globally now?`,
  );
}

async function installPlugin(
  plugin: OfficialPlugin,
  context: DelegationContext,
): Promise<boolean> {
  if (!(await confirmPluginInstall(plugin, context))) {
    context.output.problem(describeMissingPlugin(plugin, context));
    return false;
  }
  const execution = await runGlobalInstall({
    packageSpec: plugin.package,
    packageManager: context.packageManager,
    output: context.output,
    processOptions: context.processOptions,
  });
  if (execution.exitCode !== SUCCESS_EXIT_CODE) {
    context.output.error(`Installation failed: ${execution.command}`);
    return false;
  }
  return true;
}

async function installAndLocate(
  plugin: OfficialPlugin,
  context: DelegationContext,
): Promise<ResolvedExecutable | undefined> {
  if (!(await installPlugin(plugin, context))) {
    return undefined;
  }
  const executable = await context.lookupExecutable(plugin.bin);
  if (!executable) {
    context.output.error(
      `${plugin.package} was installed but ${plugin.bin} is not available in PATH.`,
    );
  }
  return executable;
}

async function isCompatible(
  executable: ResolvedExecutable,
  plugin: OfficialPlugin,
  context: DelegationContext,
): Promise<boolean> {
  const compatibility = await checkPluginCompatibility(
    executable,
    context.coreVersion,
    plugin,
    context.packageLookup,
  );
  const report = reportCompatibility(
    plugin,
    context.coreVersion,
    compatibility,
  );
  if (report.warning) {
    context.output.warn(report.warning);
  }
  if (report.problem) {
    context.output.problem(report.problem);
  }
  return report.canDelegate;
}

function pluginProcessOptions(
  invocation: PluginInvocation,
  context: DelegationContext,
): InheritedProcessOptions {
  const { processOptions } = context;
  return {
    ...processOptions,
    env: { ...(processOptions.env ?? process.env), ...invocation.environment },
  };
}

async function runPlugin(
  executable: ResolvedExecutable,
  invocation: PluginInvocation,
  context: DelegationContext,
): Promise<DelegatedPluginResult> {
  return delegated(
    await runCommand(
      executable.path,
      invocation.args.slice(1),
      context.output,
      pluginProcessOptions(invocation, context),
    ),
  );
}

function runThirdPartyPlugin(
  executable: ResolvedExecutable,
  invocation: PluginInvocation,
  context: DelegationContext,
): Promise<DelegatedPluginResult> {
  context.output.info(
    `Running third-party plugin ${pluginBinary(invocation.args[0])} (${displayPath(executable.path)})`,
  );
  return runPlugin(executable, invocation, context);
}

async function delegateToOfficialPlugin(
  plugin: OfficialPlugin,
  executable: ResolvedExecutable | undefined,
  invocation: PluginInvocation,
  context: DelegationContext,
): Promise<PluginDelegationResult> {
  const resolved = executable ?? (await installAndLocate(plugin, context));
  if (!resolved || !(await isCompatible(resolved, plugin, context))) {
    return delegated(FAILURE_EXIT_CODE);
  }
  return runPlugin(resolved, invocation, context);
}

/**
 * Runs `ajs <plugin> ...` as the plugin executable. Global options given
 * before the plugin name (`--no-color`, `--verbose`) reach the plugin as
 * `NO_COLOR` and `ANTELOPEJS_VERBOSE`; the arguments after it are forwarded
 * verbatim.
 */
export async function delegateToPlugin(
  args: string[],
  dependencies: PluginDelegationDependencies = {},
): Promise<PluginDelegationResult> {
  const invocation = parsePluginInvocation(args);
  const command = invocation.args[0];
  if (!command || command.startsWith("-")) {
    return NOT_DELEGATED;
  }

  const context = createContext(dependencies);
  const plugin = findOfficialPlugin(command);
  const executable = await context.lookupExecutable(
    plugin?.bin ?? pluginBinary(command),
  );

  if (!plugin) {
    return executable
      ? runThirdPartyPlugin(executable, invocation, context)
      : NOT_DELEGATED;
  }
  return delegateToOfficialPlugin(plugin, executable, invocation, context);
}
