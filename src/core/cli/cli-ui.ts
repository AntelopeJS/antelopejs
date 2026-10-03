import chalk from "chalk";
import figlet from "figlet";
import type { Options as BoxenOptions } from "boxen";

import {
  getProcessTasks,
  getProcessUi,
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

export async function displayBox(
  message: string,
  title?: string,
  options?: BoxenOptions,
): Promise<void> {
  /* `boxen` is ESM-only and this package emits CommonJS, so a literal `import()`
     would be downlevelled by tsc into `require()` and fail at run time. Building
     the importer through `new Function` hides it from the compiler so it stays a
     real ESM import. */
  // oxlint-disable-next-line typescript/no-implied-eval -- see above
  const dynamicImport = new Function("specifier", "return import(specifier)");
  const boxen = (await dynamicImport("boxen")).default as (
    input: string,
    options?: BoxenOptions,
  ) => string;
  const defaultOptions: BoxenOptions = {
    padding: 1,
    margin: 1,
    borderStyle: "round",
    borderColor: "blue",
    title: title,
    titleAlignment: "center",
  };
  console.log(boxen(message, { ...defaultOptions, ...options }));
}

export function displayBanner(text: string, font?: figlet.FontName): void {
  const figletText = figlet.textSync(text, { font: font || "Standard" });
  console.error(chalk.blue(figletText));
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
  error(message: string): void;
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

export function keyValue(
  key: string,
  value: string | number | boolean,
): string {
  return `${chalk.cyan(key)}: ${value}`;
}

export const consoleOutput: CommandOutput = {
  info: (message: string) => info(message),
  error: (message: string) => error(message),
};
