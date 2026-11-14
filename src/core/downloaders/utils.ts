import type { ModuleInstallCommand } from "@antelopejs/interface-core/config";
import * as os from "node:os";
import * as path from "node:path";

import type { IFileSystem } from "../../types";
import { isObject } from "../../utils";
import { CliError, ExecError, FAILURE_EXIT_CODE, runTask } from "../output";
import { DownloadLockTakenOverError, type ModuleCache } from "../modules";
import type { CommandRunner, DebugLogger } from "./types";

/**
 * `exec`, except that each command first checks that this run still holds
 * the download lock of `module` in `cache`, as
 * {@link ModuleCache.ensureDownloadLockHeld} does. A download runs its git
 * and install commands through it, so that none of them writes the folder
 * after another process took the lock over.
 */
export function underDownloadLock(
  cache: ModuleCache,
  module: string,
  exec: CommandRunner,
): CommandRunner {
  return async (command, options) => {
    await cache.ensureDownloadLockHeld(module);
    return exec(command, options);
  };
}

const PACKAGE_JSON = "package.json";
const NODE_MODULES = "node_modules";

/**
 * The names of the dependencies a package.json declares that an install
 * always puts in place, or `undefined` when its shape is not a manifest. A
 * name `optionalDependencies` also lists is left out, since npm skips it on
 * a platform it does not support.
 */
function declaredDependencies(text: string): string[] | undefined {
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed)) {
    return undefined;
  }
  const { dependencies, optionalDependencies } = parsed;
  if (dependencies === undefined || dependencies === null) {
    return [];
  }
  if (!isObject(dependencies)) {
    return undefined;
  }
  const optional = isObject(optionalDependencies) ? optionalDependencies : {};
  return Object.keys(dependencies).filter(
    (name) => !Object.hasOwn(optional, name),
  );
}

/**
 * The dependencies the `package.json` of `folder` declares that an install
 * always puts in place, as {@link declaredDependencies} reads them, or
 * `undefined` when the folder has no `package.json` or it is not a manifest.
 */
export async function readDeclaredDependencies(
  folder: string,
  fs: IFileSystem,
): Promise<string[] | undefined> {
  try {
    return declaredDependencies(
      await fs.readFileString(path.join(folder, PACKAGE_JSON)),
    );
  } catch {
    return undefined;
  }
}

/** Whether `node_modules` of `folder` holds a `package.json` for each of `dependencies`. */
export async function hasInstalledDependencies(
  folder: string,
  dependencies: string[],
  fs: IFileSystem,
): Promise<boolean> {
  const installed = await Promise.all(
    dependencies.map((name) =>
      fs.exists(path.join(folder, NODE_MODULES, name, PACKAGE_JSON)),
    ),
  );
  return installed.every(Boolean);
}

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
    if (err instanceof DownloadLockTakenOverError) {
      throw err;
    }
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
