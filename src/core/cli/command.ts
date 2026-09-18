import { Logging } from "@antelopejs/interface-core/logging";
import { type ChildProcess, type ExecOptions, exec } from "node:child_process";

const Logger = new Logging.Channel("cli.command");

const NON_INTERACTIVE_ENV: Record<string, string> = {
  CI: "1",
};

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Build the exec options used for every command: the caller's options plus
 * `CI=1`, which makes package managers fail fast instead of prompting.
 */
export function nonInteractiveOptions(options: ExecOptions): ExecOptions {
  return {
    ...options,
    env: {
      ...(options.env ?? process.env),
      ...NON_INTERACTIVE_ENV,
    },
  };
}

/**
 * Close the child stdin so a command waiting for an answer gets EOF instead
 * of hanging on a pipe nobody writes to.
 */
export function closeStdin(child: ChildProcess): void {
  child.stdin?.end();
}

/**
 * Runs a shell command and resolves with its output.
 *
 * Commands always run non-interactively: the child gets an immediately closed
 * stdin and `CI=1` in its environment, so a package manager asking a question
 * (for instance pnpm's "Proceed? (Y/n)") fails fast instead of waiting forever
 * on a stdin nobody can write to.
 */
export function ExecuteCMD(
  command: string,
  options: ExecOptions,
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    Logger.Trace(`Executing command: ${command}`);
    const child = exec(
      command,
      nonInteractiveOptions(options),
      (err, stdout, stderr) => {
        const result: CommandResult = {
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          code: err ? err.code || 1 : 0,
        };

        if (err) {
          Logger.Error("Command execution failed:", command);
          const message = result.stderr || result.stdout || err.message;
          return reject(message);
        }
        resolve(result);
      },
    );
    closeStdin(child);
  });
}
