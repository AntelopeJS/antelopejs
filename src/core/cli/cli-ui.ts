import chalk from "chalk";
import figlet from "figlet";
import type { Options as BoxenOptions } from "boxen";

import { isTerminalOutput } from "./logging-utils";
import { getProcessUi, type MessageLevel } from "./output";

const clearLine = () => process.stderr.write("\r\x1b[K");
const SPINNER_INTERVAL_MS = 80;

export class Spinner {
  private text: string;
  private isRunning = false;
  private interval?: NodeJS.Timeout;
  private currentCharIndex = 0;
  private isTerminal = isTerminalOutput();
  private readonly frames = getProcessUi().symbols.spinner;

  constructor(text: string) {
    this.text = text;
  }

  async start(text?: string): Promise<Spinner> {
    if (text) this.text = text;
    if (this.isRunning) return this;

    this.isRunning = true;
    this.currentCharIndex = 0;

    if (!this.isTerminal) return this;

    this.interval = setInterval(() => {
      if (this.isRunning) {
        process.stderr.write(`\r${this.currentFrame()} ${this.text}`);
        this.currentCharIndex =
          (this.currentCharIndex + 1) % this.frames.length;
      }
    }, SPINNER_INTERVAL_MS);

    return this;
  }

  update(text: string): Spinner {
    this.text = text;
    return this;
  }

  log(stream: NodeJS.WriteStream, message: string): Spinner {
    if (this.isRunning && this.isTerminal) {
      clearLine();
      stream.write(`${message}\n`);
      process.stderr.write(`${this.currentFrame()} ${this.text}`);
    } else {
      stream.write(`${message}\n`);
    }
    return this;
  }

  async succeed(text?: string): Promise<void> {
    await this.finish("success", text);
  }

  async fail(text?: string): Promise<void> {
    await this.finish("error", text);
  }

  async info(text?: string): Promise<void> {
    await this.finish("info", text);
  }

  async warn(text?: string): Promise<void> {
    await this.finish("warn", text);
  }

  private async finish(level: MessageLevel, text?: string): Promise<void> {
    if (!this.isRunning) return;
    await this.stop();
    getProcessUi().message(level, text || this.text);
  }

  private currentFrame(): string {
    return this.frames[this.currentCharIndex];
  }

  async pause(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    if (this.isTerminal) clearLine();
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    this.isRunning = false;
    if (this.isTerminal) clearLine();
  }

  async clear(): Promise<void> {
    await this.stop();
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
