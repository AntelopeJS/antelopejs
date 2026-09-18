import { getCoreVersion } from "./core-version";
import type { PluginPackageLookup } from "./plugin-package";
import { consoleOutput, type CommandOutput } from "./cli-ui";
import type { InheritedProcessOptions } from "./process-runner";
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

type PluginInstallPrompt = (message: string) => Promise<boolean>;

interface InstallConfirmation {
  confirmed: boolean;
}

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

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptForInstall(message: string): Promise<boolean> {
  const inquirer = (await import("inquirer")).default;
  const { confirmed } = await inquirer.prompt<InstallConfirmation>([
    { type: "confirm", name: "confirmed", message, default: true },
  ]);
  return confirmed;
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
    isInteractive: dependencies.isInteractive ?? isInteractiveTerminal,
    coreVersion: dependencies.coreVersion ?? getCoreVersion(),
    packageManager,
    output: dependencies.output ?? consoleOutput,
  };
}

function delegated(exitCode: number): DelegatedPluginResult {
  return { isDelegated: true, exitCode };
}

async function installPlugin(
  plugin: OfficialPlugin,
  context: DelegationContext,
): Promise<boolean> {
  const formatted = formatGlobalCommand(
    getGlobalInstallCommand(
      plugin.package,
      context.packageManager,
      context.processOptions.platform,
    ),
  );
  const label = officialPluginLabel(plugin);

  if (!context.isInteractive()) {
    context.output.error(`The ${label} plugin is not installed.`);
    context.output.error(`Install it with: ${formatted}`);
    return false;
  }

  const confirmed = await context.confirmInstall(
    `The ${label} plugin is not installed. Install ${plugin.package} globally now?`,
  );
  if (!confirmed) {
    context.output.error(`Install it with: ${formatted}`);
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
  report.messages.forEach((message) => context.output.error(message));
  return report.canDelegate;
}

async function runPlugin(
  executable: ResolvedExecutable,
  args: string[],
  context: DelegationContext,
): Promise<DelegatedPluginResult> {
  return delegated(
    await runCommand(
      executable.path,
      args.slice(1),
      context.output,
      context.processOptions,
    ),
  );
}

async function delegateToOfficialPlugin(
  plugin: OfficialPlugin,
  executable: ResolvedExecutable | undefined,
  args: string[],
  context: DelegationContext,
): Promise<PluginDelegationResult> {
  const resolved = executable ?? (await installAndLocate(plugin, context));
  if (!resolved || !(await isCompatible(resolved, plugin, context))) {
    return delegated(FAILURE_EXIT_CODE);
  }
  return runPlugin(resolved, args, context);
}

export async function delegateToPlugin(
  args: string[],
  dependencies: PluginDelegationDependencies = {},
): Promise<PluginDelegationResult> {
  const command = args[0];
  if (!command || command.startsWith("-")) {
    return NOT_DELEGATED;
  }

  const context = createContext(dependencies);
  const plugin = findOfficialPlugin(command);
  const executable = await context.lookupExecutable(
    plugin?.bin ?? pluginBinary(command),
  );

  if (!plugin) {
    return executable ? runPlugin(executable, args, context) : NOT_DELEGATED;
  }
  return delegateToOfficialPlugin(plugin, executable, args, context);
}
