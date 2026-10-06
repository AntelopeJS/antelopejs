import { Logging } from "@antelopejs/interface-core/logging";
import {
  type ChildProcess,
  type ExecFileOptions,
  type ExecOptions,
  exec,
  execFile,
} from "node:child_process";

import { FAILURE_EXIT_CODE } from "./exit-codes";
import { buildProcessInvocation } from "./windows-command-line";

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
  return { ...options, env: nonInteractiveEnv(options.env) };
}

function nonInteractiveEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...env, ...NON_INTERACTIVE_ENV };
}

/**
 * Close the child stdin so a command waiting for an answer gets EOF instead
 * of hanging on a pipe nobody writes to.
 */
export function closeStdin(child: ChildProcess): void {
  child.stdin?.end();
}

function exitCodeOf(err: Error): number {
  const code = "code" in err ? err.code : undefined;
  return typeof code === "number" && code !== 0 ? code : FAILURE_EXIT_CODE;
}

interface CommandOutput {
  toString(): string;
}

type CommandCallback = (
  err: Error | null,
  stdout: CommandOutput,
  stderr: CommandOutput,
) => void;

type CommandResolver = (result: CommandResult) => void;

type CommandRejecter = (error: ExecError) => void;

function settleCommand(
  command: string,
  resolve: CommandResolver,
  reject: CommandRejecter,
): CommandCallback {
  return (err, stdout, stderr) => {
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
  };
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
      settleCommand(command, resolve, reject),
    );
    closeStdin(child);
  });
}

/**
 * Runs an executable without a shell, like {@link ExecuteCMD} runs a command.
 *
 * Without a shell in between, the child is the executable itself: aborting
 * `options.signal` terminates it rather than a shell that would leave it
 * running.
 */
export function ExecuteFile(
  executable: string,
  args: string[],
  options: ExecFileOptions,
): Promise<CommandResult> {
  const command = [executable, ...args].join(" ");
  const invocation = buildProcessInvocation(executable, args);
  return new Promise<CommandResult>((resolve, reject) => {
    Logger.Trace(`Executing command: ${command}`);
    const child = execFile(
      invocation.executable,
      invocation.args,
      {
        ...options,
        env: nonInteractiveEnv(options.env),
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      },
      settleCommand(command, resolve, reject),
    );
    closeStdin(child);
  });
}
