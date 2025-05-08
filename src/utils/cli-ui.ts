import chalk from 'chalk';
import figlet from 'figlet';
import cliProgress from 'cli-progress';
import type { Options as BoxenOptions } from 'boxen';
import type { Ora } from 'ora';

/**
 * Creates and manages a spinner with customizable text and success/error messages.
 */
export class Spinner {
  private text: string;
  private spinner: Ora | null = null;
  private ora: any = null;

  /**
   * Create a new spinner with the given text
   */
  constructor(text: string) {
    this.text = text;
  }

  /**
   * Load the ora package dynamically
   */
  private async loadOra(): Promise<any> {
    if (this.ora) return this.ora;

    const dynamicImport = new Function('specifier', 'return import(specifier)');
    this.ora = (await dynamicImport('ora')).default;
    return this.ora;
  }

  /**
   * Start the spinner
   */
  async start(text?: string): Promise<Spinner> {
    if (text) {
      this.text = text;
    }

    const ora = await this.loadOra();
    this.spinner = ora({
      text: this.text,
      color: 'blue',
    });
    this.spinner?.start();
    return this;
  }

  /**
   * Update the spinner text
   */
  update(text: string): Spinner {
    this.text = text;
    if (this.spinner) {
      this.spinner.text = text;
    }
    return this;
  }

  /**
   * Stop the spinner with a success message
   */
  async succeed(text?: string): Promise<void> {
    if (!this.spinner) {
      const ora = await this.loadOra();
      this.spinner = ora({
        text: text || this.text,
        color: 'blue',
      });
    }
    this.spinner?.succeed(text || this.text);
    this.spinner = null;
  }

  /**
   * Stop the spinner with an error message
   */
  async fail(text?: string): Promise<void> {
    if (!this.spinner) {
      const ora = await this.loadOra();
      this.spinner = ora({
        text: text || this.text,
        color: 'blue',
      });
    }
    this.spinner?.fail(text || this.text);
    this.spinner = null;
  }

  /**
   * Stop the spinner with an info message
   */
  async info(text?: string): Promise<void> {
    if (!this.spinner) {
      const ora = await this.loadOra();
      this.spinner = ora({
        text: text || this.text,
        color: 'blue',
      });
    }
    this.spinner?.info(text || this.text);
    this.spinner = null;
  }

  /**
   * Stop the spinner with a warning message
   */
  async warn(text?: string): Promise<void> {
    if (!this.spinner) {
      const ora = await this.loadOra();
      this.spinner = ora({
        text: text || this.text,
        color: 'blue',
      });
    }
    this.spinner?.warn(text || this.text);
    this.spinner = null;
  }

  /**
   * Stop the spinner without any status
   */
  async stop(): Promise<void> {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
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
  const boxen = (await dynamicImport('boxen')).default;
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
  console.log(chalk.green(`✓ ${message}`));
}

/**
 * Displays an error message with red coloring and an X
 */
export function error(message: string): void {
  console.log(chalk.red(`✗ ${message}`));
}

/**
 * Displays a warning message with yellow coloring and a warning symbol
 */
export function warning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

/**
 * Displays an info message with blue coloring and an info symbol
 */
export function info(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`));
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
