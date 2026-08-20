#!/usr/bin/env node

const START_COMMAND = "start";
const PROJECT_COMMAND = "project";

export function isProductionStartInvocation(args: string[]): boolean {
  return args[0] === PROJECT_COMMAND && args[1] === START_COMMAND;
}

export async function runCLI(
  args: string[] = process.argv.slice(2),
): Promise<void> {
  if (isProductionStartInvocation(args)) {
    const { runProductionStart } = await import("./production-start");
    await runProductionStart(args.slice(2));
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

if (require.main === module) {
  runCLI().catch((error) => {
    if (isExitPromptError(error)) {
      process.exit(0);
    }
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exit(1);
  });
}
