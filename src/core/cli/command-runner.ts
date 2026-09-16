import type { CommandOutput } from "./cli-ui";
import { FAILURE_EXIT_CODE } from "./exit-codes";
import type { PackageManagerName } from "./package-manager-name";
import {
  runInheritedProcess,
  type InheritedProcessOptions,
} from "./process-runner";
import {
  formatGlobalCommand,
  getGlobalInstallCommand,
} from "./global-package-manager";

export interface CommandExecution {
  command: string;
  exitCode: number;
}

export interface GlobalInstallRequest {
  packageSpec: string;
  packageManager: PackageManagerName;
  output: CommandOutput;
  processOptions?: InheritedProcessOptions;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCommand(
  executable: string,
  args: string[],
  output: CommandOutput,
  processOptions: InheritedProcessOptions = {},
): Promise<number> {
  try {
    return await runInheritedProcess(executable, args, processOptions);
  } catch (error) {
    output.error(`Failed to run ${executable}: ${describeError(error)}`);
    return FAILURE_EXIT_CODE;
  }
}

export async function runGlobalInstall(
  request: GlobalInstallRequest,
): Promise<CommandExecution> {
  const command = getGlobalInstallCommand(
    request.packageSpec,
    request.packageManager,
    request.processOptions?.platform,
  );
  const formatted = formatGlobalCommand(command);
  request.output.info(`Running: ${formatted}`);
  return {
    command: formatted,
    exitCode: await runCommand(
      command.executable,
      command.args,
      request.output,
      request.processOptions,
    ),
  };
}
