#!/usr/bin/env node

const START_COMMAND = "start";
const PROJECT_COMMAND = "project";
const OPTION_PREFIX = "-";

export function isProductionStartInvocation(args: string[]): boolean {
  return args[0] === PROJECT_COMMAND && args[1] === START_COMMAND;
}

async function isCoreCommand(command: string): Promise<boolean> {
  const { coreCommandNames } = await import("./full-cli");
  return coreCommandNames().includes(command);
}

async function delegateToPluginCommand(args: string[]): Promise<boolean> {
  const command = args[0];
  if (!command || command.startsWith(OPTION_PREFIX)) {
    return false;
  }
  const { findOfficialPlugin } = await import("./plugin-registry");
  if (!findOfficialPlugin(command) && (await isCoreCommand(command))) {
    return false;
  }
  const { delegateToPlugin } = await import("./plugin");
  const result = await delegateToPlugin(args);
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

function isExitPromptError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "ExitPromptError"
  );
}

async function runCLIAsMain(): Promise<void> {
  const { forceExitOnFailure } = await import("./failure-exit");
  await runCLI();
  forceExitOnFailure();
}

if (require.main === module) {
  runCLIAsMain().catch((error) => {
    if (isExitPromptError(error)) {
      process.exit(0);
    }
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exit(1);
  });
}
