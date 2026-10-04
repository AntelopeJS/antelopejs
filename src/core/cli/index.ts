#!/usr/bin/env node

import {
  helpAsPluginArguments,
  parsePluginInvocation,
} from "./plugin-arguments";

const START_COMMAND = "start";
const PROJECT_COMMAND = "project";
const OPTION_PREFIX = "-";
const HELP_FLAGS = ["-h", "--help"];

/**
 * Whether the arguments run `ajs project start`, which launches the build
 * artifact without loading the development CLI. Its help is left to the
 * development CLI so that every help page reads the same.
 */
export function isProductionStartInvocation(args: string[]): boolean {
  return (
    args[0] === PROJECT_COMMAND &&
    args[1] === START_COMMAND &&
    !args.some((arg) => HELP_FLAGS.includes(arg))
  );
}

async function isCoreCommand(command: string): Promise<boolean> {
  const { coreCommandNames } = await import("./full-cli");
  return coreCommandNames().includes(command);
}

/**
 * Runs the command line as a plugin when it names one, `ajs help <plugin>`
 * included: the plugin prints its own help.
 */
async function delegateToPluginCommand(args: string[]): Promise<boolean> {
  const pluginArgs = helpAsPluginArguments(args);
  const command = parsePluginInvocation(pluginArgs).args[0];
  if (!command || command.startsWith(OPTION_PREFIX)) {
    return false;
  }
  const { findOfficialPlugin } = await import("./plugin-registry");
  if (!findOfficialPlugin(command) && (await isCoreCommand(command))) {
    return false;
  }
  const { delegateToPlugin } = await import("./plugin");
  const result = await delegateToPlugin(pluginArgs);
  if (!result.isDelegated) {
    return false;
  }
  process.exitCode = result.exitCode;
  return true;
}

export async function runCLI(
  args: string[] = process.argv.slice(2),
): Promise<void> {
  if (isProductionStartInvocation(args)) {
    const { runProductionStart } = await import("./production-start");
    await runProductionStart(args.slice(2));
    return;
  }
  if (await delegateToPluginCommand(args)) {
    return;
  }
  const fullCLI = await import("./full-cli");
  await fullCLI.runCLI();
}

async function runCLIAsMain(): Promise<void> {
  const { runWithErrorBoundary } = await import("./output/boundary");
  await runWithErrorBoundary(() => runCLI());
  const { forceExitOnFailure } = await import("./failure-exit");
  forceExitOnFailure();
}

if (require.main === module) {
  void runCLIAsMain();
}
