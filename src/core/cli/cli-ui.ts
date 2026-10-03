import {
  getProcessTasks,
  getProcessUi,
  type CliProblem,
  type MessageLevel,
  type OutputStream,
  type TaskHandle,
  type TaskList,
} from "./output";

const LINE_END = "\n";

/**
 * A single spinner, drawn as one task of the process task list so log lines
 * and messages never break it, and only printing its final line in CI and
 * pipes.
 */
export class Spinner {
  private task?: TaskHandle;

  constructor(
    private text: string,
    private readonly tasks: TaskList = getProcessTasks(),
  ) {}

  start(text?: string): Promise<Spinner> {
    if (text) this.text = text;
    this.task ??= this.tasks.start(this.text);
    return Promise.resolve(this);
  }

  update(text: string): Spinner {
    this.text = text;
    this.task?.update(text);
    return this;
  }

  log(stream: OutputStream, message: string): Spinner {
    this.tasks.write(stream, `${message}${LINE_END}`);
    return this;
  }

  succeed(text?: string): Promise<void> {
    return this.finish("success", text);
  }

  fail(text?: string): Promise<void> {
    return this.finish("error", text);
  }

  info(text?: string): Promise<void> {
    return this.finish("info", text);
  }

  warn(text?: string): Promise<void> {
    return this.finish("warn", text);
  }

  stop(): Promise<void> {
    this.task?.dismiss();
    this.task = undefined;
    return Promise.resolve();
  }

  private async finish(level: MessageLevel, text?: string): Promise<void> {
    if (!this.task) return;
    await this.stop();
    this.tasks.ui.message(level, text || this.text);
  }
}

export function success(message: string): void {
  getProcessUi().message("success", message, { channel: "result" });
}

export function error(message: string | Error): void {
  const text = message instanceof Error ? message.message : message;
  getProcessUi().message("error", text);
}

export interface CommandOutput {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  problem(problem: CliProblem): void;
}

export function warning(message: string | Error): void {
  const text = message instanceof Error ? message.message : message;
  getProcessUi().message("warn", text);
}

export function info(message: string): void {
  getProcessUi().message("info", message);
}

export function header(text: string): void {
  getProcessUi().heading(text);
}

export const consoleOutput: CommandOutput = {
  info: (message: string) => info(message),
  warn: (message: string) => warning(message),
  error: (message: string) => error(message),
  problem: (problem: CliProblem) => getProcessUi().problem(problem),
};
