import * as os from "node:os";
import type { ModuleInstallCommand } from "@antelopejs/interface-core/config";

import { ExecError } from "../cli/command";
import { CliError } from "../cli/output/errors";
import { runTask } from "../cli/output/tasks";
import { FAILURE_EXIT_CODE } from "../cli/exit-codes";
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
      title: `Install failed for ${label}`,
      reason: `'${failure.command}' exited with code ${failure.exitCode}.`,
      fixes: [
        `Fix the command, or change the installCommand of ${label} in the project configuration`,
      ],
    },
    { cause: failure },
  );
}

async function runCommandsInOrder(
  exec: CommandRunner,
  logger: DebugLogger,
  label: string,
  folder: string,
  commands: string[],
): Promise<void> {
  for (const command of commands) {
    logger.Debug(`Executing command: ${command}`);
    const failure = await runInstallCommand(exec, folder, command);
    if (failure !== undefined) {
      throw installFailure(label, failure);
    }
  }
}

/**
 * Runs the install commands of a module as one task. A failure is not
 * printed here: it is thrown once, for whoever loads the module to report.
 */
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
  await runTask(
    `Installing dependencies for ${label}`,
    () => runCommandsInOrder(exec, logger, label, folder, commands),
    { done: `Installed dependencies for ${label}` },
  );
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
