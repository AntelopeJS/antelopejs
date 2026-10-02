import * as os from "node:os";
import type { ModuleInstallCommand } from "@antelopejs/interface-core/config";

import { error } from "../cli/cli-ui";
import { ExecError } from "../cli/command";
import { CliError } from "../cli/output";
import { FAILURE_EXIT_CODE } from "../cli/exit-codes";
import { terminalDisplay } from "../cli/terminal-display";
import type { CommandRunner, DebugLogger } from "./types";

function normalizeCommands(installCommand?: ModuleInstallCommand): string[] {
  if (!installCommand) {
    return [];
  }
  return Array.isArray(installCommand) ? installCommand : [installCommand];
}

function toExecError(err: unknown, command: string): ExecError {
  if (err instanceof ExecError) {
    return err;
  }
  const stderr = err instanceof Error ? err.message : String(err);
  return new ExecError({
    command,
    stdout: "",
    stderr,
    code: FAILURE_EXIT_CODE,
  });
}

async function runInstallCommand(
  exec: CommandRunner,
  folder: string,
  command: string,
): Promise<ExecError | undefined> {
  try {
    const result = await exec(command, { cwd: folder });
    return result.code === 0
      ? undefined
      : new ExecError({ ...result, command });
  } catch (err) {
    return toExecError(err, command);
  }
}

export function installFailure(label: string, failure: ExecError): CliError {
  return new CliError(
    {
      title: `Failed to install dependencies for ${label}`,
      reason: `'${failure.command}' exited with code ${failure.exitCode}.`,
      fixes: [
        `Fix the command, or change the installCommand of ${label} in the project configuration`,
      ],
    },
    { cause: failure },
  );
}

async function reportInstallFailure(message: string): Promise<void> {
  if (terminalDisplay.isSpinnerActive()) {
    await terminalDisplay.failSpinner(message);
    return;
  }
  error(message);
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
    const failure = await runInstallCommand(exec, folder, command);
    if (failure === undefined) {
      continue;
    }
    await reportInstallFailure(
      `Install failed for ${label} (${command}, exit ${failure.exitCode})`,
    );
    throw installFailure(label, failure);
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
