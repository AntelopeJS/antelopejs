import { Logging } from "@antelopejs/interface-core/logging";
import {
  type ChildProcess,
  type ExecException,
  type ExecOptions,
  exec,
} from "node:child_process";

import { FAILURE_EXIT_CODE } from "./exit-codes";

const Logger = new Logging.Channel("cli.command");

const NON_INTERACTIVE_ENV: Record<string, string> = {
  CI: "1",
  GIT_TERMINAL_PROMPT: "0",
};

const EXEC_ERROR_NAME = "ExecError";

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecFailure extends CommandResult {
  command: string;
}

/**
 * A command that exited with a non-zero code. Carries the command, its exit
 * code and its whole output, so the caller decides what to show instead of
 * replaying the child output.
 */
export class ExecError extends Error {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;

  constructor(failure: ExecFailure) {
    super(`Command '${failure.command}' failed with exit code ${failure.code}`);
    this.name = EXEC_ERROR_NAME;
    this.command = failure.command;
    this.stdout = failure.stdout;
    this.stderr = failure.stderr;
    this.exitCode = failure.code;
  }

  get output(): string {
    return this.stderr || this.stdout;
  }
}

/**
 * Build the exec options used for every command: the caller's options plus
 * `CI=1`, which makes package managers fail fast instead of prompting, and
 * `GIT_TERMINAL_PROMPT=0`, which makes git fail instead of asking for
 * credentials.
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

function exitCodeOf(err: ExecException): number {
  return typeof err.code === "number" && err.code !== 0
    ? err.code
    : FAILURE_EXIT_CODE;
}

/**
 * Runs a shell command and resolves with its output, or rejects with an
 * {@link ExecError} when it exits with a non-zero code.
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
          code: err ? exitCodeOf(err) : 0,
        };
        if (err) {
          Logger.Debug(`Command failed with code ${result.code}: ${command}`);
          return reject(new ExecError({ ...result, command }));
        }
        resolve(result);
      },
    );
    closeStdin(child);
  });
}
