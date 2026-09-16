import { getCoreVersion } from "./core-version";
import type { PluginPackageLookup } from "./plugin-package";
import { consoleOutput, type CommandOutput } from "./cli-ui";
import { findExecutable, type ExecutableLookup } from "./executable-lookup";
import {
  nodeProcessRunner,
  runInheritedProcess,
  type ProcessRunner,
} from "./process-runner";
import {
  checkPluginCompatibility,
  formatIncompatibilityMessages,
} from "./plugin-compatibility";
import {
  findOfficialPlugin,
  officialPluginLabel,
  type OfficialPlugin,
} from "./plugin-registry";
import {
  detectGlobalPackageManager,
  formatGlobalCommand,
  getGlobalInstallCommand,
  type GlobalPackageManagerName,
} from "./global-package-manager";

const PLUGIN_PREFIX = "ajs-";
const PLUGIN_FAILURE_EXIT_CODE = 1;
const SUCCESS_EXIT_CODE = 0;

type PluginInstallPrompt = (message: string) => Promise<boolean>;

export interface PluginDelegationResult {
  isDelegated: boolean;
  exitCode?: number;
}

export interface PluginDelegationDependencies {
  processRunner?: ProcessRunner;
  lookupExecutable?: ExecutableLookup;
  packageLookup?: PluginPackageLookup;
  confirmInstall?: PluginInstallPrompt;
  isInteractive?: () => boolean;
  coreVersion?: string;
  packageManager?: GlobalPackageManagerName;
  output?: CommandOutput;
}

interface DelegationContext {
  processRunner: ProcessRunner;
  lookupExecutable: ExecutableLookup;
  packageLookup: PluginPackageLookup;
  confirmInstall: PluginInstallPrompt;
  isInteractive: () => boolean;
  coreVersion: string;
  packageManager: GlobalPackageManagerName;
  output: CommandOutput;
}

function pluginBinary(command: string): string {
  return `${PLUGIN_PREFIX}${command}`;
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptForInstall(message: string): Promise<boolean> {
  const inquirer = (await import("inquirer")).default;
  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    { type: "confirm", name: "confirmed", message, default: true },
  ]);
  return confirmed;
}

function createContext(
  dependencies: PluginDelegationDependencies,
): DelegationContext {
  return {
    processRunner: dependencies.processRunner ?? nodeProcessRunner,
    lookupExecutable: dependencies.lookupExecutable ?? findExecutable,
    packageLookup: dependencies.packageLookup ?? {},
    confirmInstall: dependencies.confirmInstall ?? promptForInstall,
    isInteractive: dependencies.isInteractive ?? isInteractiveTerminal,
    coreVersion: dependencies.coreVersion ?? getCoreVersion(),
    packageManager: dependencies.packageManager ?? detectGlobalPackageManager(),
    output: dependencies.output ?? consoleOutput,
  };
}

async function installPlugin(
  plugin: OfficialPlugin,
  context: DelegationContext,
): Promise<boolean> {
  const command = getGlobalInstallCommand(
    plugin.package,
    context.packageManager,
  );
  const formatted = formatGlobalCommand(command);
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

  context.output.info(`Running: ${formatted}`);
  const exitCode = await runInheritedProcess(
    command.executable,
    command.args,
    context.processRunner,
  );
  if (exitCode !== SUCCESS_EXIT_CODE) {
    context.output.error(`Installation failed: ${formatted}`);
    return false;
  }
  return true;
}

async function installAndLocate(
  plugin: OfficialPlugin,
  context: DelegationContext,
): Promise<string | undefined> {
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
  executable: string,
  plugin: OfficialPlugin,
  context: DelegationContext,
): Promise<boolean> {
  const compatibility = await checkPluginCompatibility(
    executable,
    context.coreVersion,
    plugin,
    context.packageLookup,
  );
  if (compatibility.isCompatible) {
    return true;
  }
  for (const message of formatIncompatibilityMessages(
    plugin,
    context.coreVersion,
    compatibility,
  )) {
    context.output.error(message);
  }
  return false;
}

async function runPlugin(
  executable: string,
  args: string[],
  context: DelegationContext,
): Promise<PluginDelegationResult> {
  return {
    isDelegated: true,
    exitCode: await runInheritedProcess(
      executable,
      args.slice(1),
      context.processRunner,
    ),
  };
}

async function delegateToOfficialPlugin(
  plugin: OfficialPlugin,
  executable: string | undefined,
  args: string[],
  context: DelegationContext,
): Promise<PluginDelegationResult> {
  const resolved = executable ?? (await installAndLocate(plugin, context));
  if (!resolved || !(await isCompatible(resolved, plugin, context))) {
    return { isDelegated: true, exitCode: PLUGIN_FAILURE_EXIT_CODE };
  }
  return runPlugin(resolved, args, context);
}

export async function delegateToPlugin(
  args: string[],
  dependencies: PluginDelegationDependencies = {},
): Promise<PluginDelegationResult> {
  const command = args[0];
  if (!command || command.startsWith("-")) {
    return { isDelegated: false };
  }

  const context = createContext(dependencies);
  const plugin = findOfficialPlugin(command);
  const executable = await context.lookupExecutable(
    plugin?.bin ?? pluginBinary(command),
  );

  if (!plugin) {
    return executable
      ? runPlugin(executable, args, context)
      : { isDelegated: false };
  }
  return delegateToOfficialPlugin(plugin, executable, args, context);
}
