import chalk from 'chalk';
import figlet from 'figlet';
import cliProgress from 'cli-progress';
import type { Options as BoxenOptions } from 'boxen';
import Logging from '../interfaces/logging/beta';
import { formatLogMessageWithRightAlignedDate, isTerminalOutput } from '../logging/utils';
import { AntelopeLogging } from '../common/config';

const clearLine = () => process.stdout.write('\r\x1b[K');
const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const defaultSpinnerLogging: AntelopeLogging = {
  enabled: true,
  moduleTracking: { enabled: false, includes: [], excludes: [] },
  formatter: {},
  dateFormat: 'yyyy-MM-dd HH:mm:ss',
};

/**
 * Creates and manages a simple spinner with customizable text and success/error messages.
 */
export class Spinner {
  private text: string;
  private isRunning = false;
  private interval?: NodeJS.Timeout;
  private currentCharIndex = 0;
  private isTerminal = isTerminalOutput();

  /**
   * Create a new spinner with the given text
   */
  constructor(text: string) {
    this.text = text;
  }

  /**
   * Start the spinner
   */
  async start(text?: string): Promise<Spinner> {
    if (text) {
      this.text = text;
    }

    if (this.isRunning) {
      return this;
    }

    this.isRunning = true;
    this.currentCharIndex = 0;

    if (!this.isTerminal) {
      return this;
    }

    this.interval = setInterval(() => {
      if (this.isRunning) {
        const spinnerChar = spinnerChars[this.currentCharIndex];
        process.stdout.write(`\r${spinnerChar} ${this.text}`);
        this.currentCharIndex = (this.currentCharIndex + 1) % spinnerChars.length;
      }
    }, 80);

    return this;
  }

  /**
   * Update the spinner text
   */
  update(text: string): Spinner {
    this.text = text;
    return this;
  }

  /**
   * Log text above the spinner without stopping it
   */
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

  /**
   * Stop the spinner with a success message
   */
  async succeed(text?: string): Promise<void> {
    if (!this.isRunning) return;

    await this.stop();
    const message = text || this.text;

    const log = {
      time: Date.now(),
      levelId: Logging.Level.NO_PREFIX.valueOf(),
      channel: 'spinner',
      args: [chalk.bold.green('✓'), message],
    };

    const formattedMessage = formatLogMessageWithRightAlignedDate(defaultSpinnerLogging, log);
    if (this.isTerminal) {
      process.stdout.write(`\r${formattedMessage}\n`);
    } else {
      console.log(formattedMessage);
    }
  }

  /**
   * Stop the spinner with an error message
   */
  async fail(text?: string): Promise<void> {
    if (!this.isRunning) return;

    await this.stop();
    const message = text || this.text;

    const log = {
      time: Date.now(),
      levelId: Logging.Level.NO_PREFIX.valueOf(),
      channel: 'spinner',
      args: [chalk.bold.red('✗'), chalk.red(message)],
    };

    const formattedMessage = formatLogMessageWithRightAlignedDate(defaultSpinnerLogging, log);
    if (this.isTerminal) {
      process.stdout.write(`\r${formattedMessage}\n`);
    } else {
      console.log(formattedMessage);
    }
  }

  /**
   * Stop the spinner with an info message
   */
  async info(text?: string): Promise<void> {
    if (!this.isRunning) return;

    await this.stop();
    const message = text || this.text;

    const log = {
      time: Date.now(),
      levelId: Logging.Level.NO_PREFIX.valueOf(),
      channel: 'spinner',
      args: [chalk.bold.blue('ℹ'), message],
    };

    const formattedMessage = formatLogMessageWithRightAlignedDate(defaultSpinnerLogging, log);
    if (this.isTerminal) {
      process.stdout.write(`\r${formattedMessage}\n`);
    } else {
      console.log(formattedMessage);
    }
  }

  /**
   * Stop the spinner with a warning message
   */
  async warn(text?: string): Promise<void> {
    if (!this.isRunning) return;

    await this.stop();
    const message = text || this.text;

    const log = {
      time: Date.now(),
      levelId: Logging.Level.NO_PREFIX.valueOf(),
      channel: 'spinner',
      args: [chalk.bold.yellow('⚠'), message],
    };

    const formattedMessage = formatLogMessageWithRightAlignedDate(defaultSpinnerLogging, log);
    if (this.isTerminal) {
      process.stdout.write(`\r${formattedMessage}\n`);
    } else {
      console.log(formattedMessage);
    }
  }

  /**
   * Pause the spinner temporarily (can be resumed)
   */
  async pause(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    if (this.isTerminal) {
      clearLine();
    }
  }

  /**
   * Stop the spinner without any status
   */
  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    this.isRunning = false;
    if (this.isTerminal) {
      clearLine();
    }
  }

  /**
   * Clear the spinner (alias for stop)
   */
  async clear(): Promise<void> {
    await this.stop();
  }
}

/**
 * Creates and manages a progress bar
 */
export class ProgressBar {
  private bar: cliProgress.SingleBar;

  /**
   * Create a new progress bar with optional format and options
   */
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

  /**
   * Start the progress bar with a total number of steps
   */
  start(total: number, startValue = 0, title = 'Processing'): ProgressBar {
    this.bar.start(total, startValue, { title });
    return this;
  }

  /**
   * Update the progress bar with an incremental amount
   */
  increment(amount = 1, payload?: Record<string, unknown>): ProgressBar {
    this.bar.increment(amount, payload);
    return this;
  }

  /**
   * Update the progress bar to a specific value
   */
  update(value: number, payload?: Record<string, unknown>): ProgressBar {
    this.bar.update(value, payload);
    return this;
  }

  /**
   * Stop the progress bar
   */
  stop(): void {
    this.bar.stop();
  }
}

/**
 * Display a formatted boxed message with title and optional styling
 */
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

/**
 * Displays a large ASCII art title with colored text
 */
export function displayBanner(text: string, font?: figlet.Fonts): void {
  const figletText = figlet.textSync(text, { font: font || 'Standard' });
  console.log(chalk.blue(figletText));
}

/**
 * Displays a success message with green coloring and a checkmark
 */
export function success(message: string): void {
  Logging.Write(Logging.Level.NO_PREFIX, 'main', `${chalk.green.bold('✓')} ${message}`);
}

/**
 * Displays an error message with red coloring and an X
 */
export function error(message: string): void {
  Logging.Write(Logging.Level.NO_PREFIX, 'main', `${chalk.red.bold('✗')} ${message}`);
}

/**
 * Displays a warning message with yellow coloring and a warning symbol
 */
export function warning(message: string): void {
  Logging.Write(Logging.Level.NO_PREFIX, 'main', `${chalk.yellow.bold('⚠')} ${message}`);
}

/**
 * Displays an info message with blue coloring and an info symbol
 */
export function info(message: string): void {
  Logging.Write(Logging.Level.NO_PREFIX, 'main', `${chalk.blue.bold('ℹ')} ${message}`);
}

/**
 * Display a section header with a colored underline
 */
export function header(text: string): void {
  console.log('');
  console.log(chalk.bold.blue(text));
  console.log(chalk.blue('─'.repeat(text.length)));
}

/**
 * Format a key-value pair for display, with the key in a different color
 */
export function keyValue(key: string, value: string | number | boolean): string {
  return `${chalk.cyan(key)}: ${value}`;
}

/**
 * Wait for the specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
