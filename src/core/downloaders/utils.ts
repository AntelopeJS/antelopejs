import * as os from "node:os";
import type { ModuleInstallCommand } from "@antelopejs/interface-core/config";

import { error } from "../cli/cli-ui";
import { terminalDisplay } from "../cli/terminal-display";
import type { CommandRunner, DebugLogger } from "./types";

function normalizeCommands(installCommand?: ModuleInstallCommand): string[] {
  if (!installCommand) {
    return [];
  }
  return Array.isArray(installCommand) ? installCommand : [installCommand];
}

export function installFailureMessage(
  label: string,
  command: string,
  details: string,
): string {
  const reason = details.trim();
  return `Failed to install dependencies for ${label} (command: ${command})${
    reason ? `: ${reason}` : ""
  }`;
}

async function runInstallCommand(
  exec: CommandRunner,
  folder: string,
  command: string,
): Promise<string | undefined> {
  try {
    const result = await exec(command, { cwd: folder });
    if (result.code === 0) {
      return undefined;
    }
    return (
      result.stderr ||
      result.stdout ||
      `command exited with code ${result.code}`
    );
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export async function runInstallCommands(
  exec: CommandRunner,
  logger: DebugLogger,
  label: string,
  folder: string,
  installCommand?: ModuleInstallCommand,
): Promise<void> {
  const commands = normalizeCommands(installCommand);
  if (commands.length === 0) {
    return;
  }

  await terminalDisplay.startSpinner(`Installing dependencies for ${label}`);
  for (const command of commands) {
    logger.Debug(`Executing command: ${command}`);
    const details = await runInstallCommand(exec, folder, command);
    if (details === undefined) {
      continue;
    }
    const message = installFailureMessage(label, command, details);
    const spinnerReportsFailure = terminalDisplay.isSpinnerActive();
    await terminalDisplay.failSpinner(message);
    if (!spinnerReportsFailure) {
      error(message);
    }
    throw new Error(message);
  }
  await terminalDisplay.stopSpinner(`Dependencies installed for ${label}`);
}

export function expandHome(input: string): string {
  const homeDir = os.homedir();

  if (input.startsWith("~")) {
    return homeDir + input.slice(1);
  }

  if (input.includes("~")) {
    const parts = input.split("~");
    if (parts[0].startsWith(homeDir)) {
      return `${homeDir}/${parts[1].replace(/^\/+/, "")}`;
    }
    return input.replace(/~/g, homeDir).replace(/\/+/, "/");
  }

  return input;
}
