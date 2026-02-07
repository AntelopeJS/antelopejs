import chalk from 'chalk';
import figlet from 'figlet';
import cliProgress from 'cli-progress';
import type { Options as BoxenOptions } from 'boxen';

const clearLine = () => process.stdout.write('\r\x1b[K');
const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

export function isTerminalOutput(): boolean {
  return process.stdout.isTTY && process.stderr.isTTY;
}

export class Spinner {
  private text: string;
  private isRunning = false;
  private interval?: NodeJS.Timeout;
  private currentCharIndex = 0;
  private isTerminal = isTerminalOutput();

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
        const spinnerChar = spinnerChars[this.currentCharIndex];
        process.stdout.write(`\r${spinnerChar} ${this.text}`);
        this.currentCharIndex = (this.currentCharIndex + 1) % spinnerChars.length;
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
      stream.write(message + '\n');
      const spinnerChar = spinnerChars[this.currentCharIndex];
      process.stdout.write(`${spinnerChar} ${this.text}`);
    } else {
      stream.write(message + '\n');
    }
    return this;
  }

  async succeed(text?: string): Promise<void> {
    if (!this.isRunning) return;
    await this.stop();
    const message = text || this.text;
    console.log(`${chalk.green.bold('✓')} ${message}`);
  }

  async fail(text?: string): Promise<void> {
    if (!this.isRunning) return;
    await this.stop();
    const message = text || this.text;
    console.log(`${chalk.red.bold('✗')} ${chalk.red(message)}`);
  }

  async info(text?: string): Promise<void> {
    if (!this.isRunning) return;
    await this.stop();
    const message = text || this.text;
    console.log(`${chalk.blue.bold('ℹ')} ${message}`);
  }

  async warn(text?: string): Promise<void> {
    if (!this.isRunning) return;
    await this.stop();
    const message = text || this.text;
    console.log(`${chalk.yellow.bold('⚠')} ${message}`);
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

export class ProgressBar {
  private bar: cliProgress.SingleBar;

  constructor(format?: string, options?: cliProgress.Options) {
    this.bar = new cliProgress.SingleBar(
      {
        format: format || ' {bar} | {percentage}% | {value}/{total} | {title}',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
        clearOnComplete: false,
        ...options,
      },
      cliProgress.Presets.shades_classic,
    );
  }

  start(total: number, startValue = 0, title = 'Processing'): ProgressBar {
    this.bar.start(total, startValue, { title });
    return this;
  }

  increment(amount = 1, payload?: Record<string, unknown>): ProgressBar {
    this.bar.increment(amount, payload);
    return this;
  }

  update(value: number, payload?: Record<string, unknown>): ProgressBar {
    this.bar.update(value, payload);
    return this;
  }

  stop(): void {
    this.bar.stop();
  }
}

export async function displayBox(message: string, title?: string, options?: BoxenOptions): Promise<void> {
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  const boxen = (await dynamicImport('boxen')).default as (input: string, options?: BoxenOptions) => string;
  const defaultOptions: BoxenOptions = {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: 'blue',
    title: title,
    titleAlignment: 'center',
  };
  console.log(boxen(message, { ...defaultOptions, ...options }));
}

export function displayBanner(text: string, font?: figlet.Fonts): void {
  const figletText = figlet.textSync(text, { font: font || 'Standard' });
  console.log(chalk.blue(figletText));
}

export function success(message: string): void {
  console.log(`${chalk.green.bold('✓')} ${message}`);
}

export function error(message: string): void {
  console.log(`${chalk.red.bold('✗')} ${message}`);
}

export function warning(message: string): void {
  console.log(`${chalk.yellow.bold('⚠')} ${message}`);
}

export function info(message: string): void {
  console.log(`${chalk.blue.bold('ℹ')} ${message}`);
}

export function header(text: string): void {
  console.log('');
  console.log(chalk.bold.blue(text));
  console.log(chalk.blue('─'.repeat(text.length)));
}

export function keyValue(key: string, value: string | number | boolean): string {
  return `${chalk.cyan(key)}: ${value}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
