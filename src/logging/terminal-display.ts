import chalk from 'chalk';
import { Log } from '../interfaces/logging/beta/listener';
import { Logging } from '../interfaces/logging/beta';
import { Spinner } from '../utils/cli-ui';
import { getLevelInfo, getColoredText } from './utils';

export class TerminalDisplay {
  private currentSpinner: Spinner | null = null;
  private spinnerActive = false;
  private terminalWidth: number;

  constructor() {
    this.terminalWidth = process.stdout.columns || 80;
  }

  private formatDate(date: Date): string {
    const padZero = (num: number) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${padZero(date.getMonth() + 1)}-${padZero(date.getDate())} ${padZero(date.getHours())}:${padZero(date.getMinutes())}:${padZero(date.getSeconds())}`;
  }

  private serializeArgs(args: any[]): string {
    return args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
  }

  private formatMessageWithRightAlignedDate(log: Log): string {
    const dateStr = this.formatDate(new Date(log.time));
    const levelInfo = getLevelInfo(log.levelId as Logging.Level);
    const message = this.serializeArgs(log.args);

    const levelText = `[${levelInfo.name}]`;
    const coloredLevel = getColoredText(levelText, levelInfo.color);
    const messageWithLevel = `${coloredLevel} ${message}`;

    const paddingLength = this.terminalWidth - messageWithLevel.length - dateStr.length - 2;
    const padding = ' '.repeat(Math.max(0, paddingLength));

    return `${messageWithLevel}${padding}${chalk.gray(`[${dateStr}]`)}`;
  }

  async startSpinner(text: string): Promise<void> {
    if (this.currentSpinner) await this.currentSpinner.stop();
    this.currentSpinner = new Spinner(text);
    this.spinnerActive = true;
    await this.currentSpinner.start();
  }

  async stopSpinner(text?: string): Promise<void> {
    if (this.currentSpinner) {
      await this.currentSpinner.succeed(text);
      this.currentSpinner = null;
      this.spinnerActive = false;
    }
  }

  async failSpinner(text?: string): Promise<void> {
    if (this.currentSpinner) {
      await this.currentSpinner.fail(text);
      this.currentSpinner = null;
      this.spinnerActive = false;
    }
  }

  displayLog(log: Log): void {
    if (this.spinnerActive && this.currentSpinner) {
      this.currentSpinner.stop();
    }

    const formattedMessage = this.formatMessageWithRightAlignedDate(log);
    const writeFunction =
      (log.levelId as Logging.Level) === Logging.Level.ERROR
        ? process.stderr.write.bind(process.stderr)
        : process.stdout.write.bind(process.stdout);

    writeFunction(formattedMessage + '\n');

    if (this.spinnerActive && this.currentSpinner) {
      this.currentSpinner.start();
    }
  }

  displayInlineLog(log: Log): void {
    if (this.spinnerActive && this.currentSpinner) {
      this.currentSpinner.stop();
    }

    const levelInfo = getLevelInfo(log.levelId as Logging.Level);
    const message = this.serializeArgs(log.args);
    const levelText = `[${levelInfo.name}]`;
    const coloredLevel = getColoredText(levelText, levelInfo.color);
    const formattedMessage = `${coloredLevel} ${message}`;

    const writeFunction =
      (log.levelId as Logging.Level) === Logging.Level.ERROR
        ? process.stderr.write.bind(process.stderr)
        : process.stdout.write.bind(process.stdout);

    writeFunction('\r\x1b[K' + formattedMessage);

    if (this.spinnerActive && this.currentSpinner) {
      this.currentSpinner.start();
    }
  }
}

export const terminalDisplay = new TerminalDisplay();
