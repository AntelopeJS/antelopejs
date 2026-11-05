import type { ModuleInstallCommand } from "@antelopejs/interface-core/config";
import * as os from "node:os";

import { CliError, ExecError, FAILURE_EXIT_CODE, runTask } from "../output";
import type { CommandRunner, DebugLogger } from "./types";

function normalizeCommands(installCommand?: ModuleInstallCommand): string[] {
  if (!installCommand) {
    return [];
  }
  return Array.isArray(installCommand) ? installCommand : [installCommand];
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
    if (err instanceof ExecError) {
      return err;
    }
    return new ExecError({
      command,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      code: FAILURE_EXIT_CODE,
    });
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

const LEADING_HOME = /^~(?=$|[\\/])/;

/**
 * Replaces a leading `~` that stands for the home folder (`~`, `~/…` or
 * `~\…`) with `os.homedir()`. A `~` anywhere else is part of a name, such as
 * the Windows short name `RUNNER~1`, and is kept.
 */
export function expandHome(input: string): string {
  return input.replace(LEADING_HOME, () => os.homedir());
}
