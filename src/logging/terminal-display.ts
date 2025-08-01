import chalk from 'chalk';
import { Log } from '../interfaces/logging/beta/listener';
import { Logging } from '../interfaces/logging/beta';
import { Spinner } from '../utils/cli-ui';
import { getLevelInfo, getColoredText } from './utils';

export class TerminalDisplay {
  private currentSpinner: Spinner | null = null;
  private spinnerActive = false;
  private lastSpinnerText: string | null = null;
  private spinnerPaused = false;

  private terminalWidth: number;
  private pendingSpinnerUpdates: Array<{ text: string; type: 'start' | 'end' | 'fail' }> = [];
  private isRenderingSpinnerUpdates = false;
  private activeCommands = new Set<string>();

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

  private async renderPendingSpinnerUpdates(): Promise<void> {
    if (this.isRenderingSpinnerUpdates || !this.pendingSpinnerUpdates.length) return;
    this.isRenderingSpinnerUpdates = true;

    const spin = (text: string) => (this.currentSpinner = new Spinner(text));
    const stopCurrentSpinner = () => this.currentSpinner?.stop().then(() => (this.currentSpinner = null));

    for (const { type, text } of this.pendingSpinnerUpdates.splice(0)) {
      if (type === 'start') {
        this.activeCommands.add(text);
        await stopCurrentSpinner();
        await spin(text).start();
        this.spinnerActive = true;
        this.spinnerPaused = false;
      } else {
        this.activeCommands.delete(text);
        await (type === 'end' ? this.currentSpinner?.succeed(text) : this.currentSpinner?.fail(text));
        await stopCurrentSpinner();
        if (this.activeCommands.size) {
          const nextCommand = Array.from(this.activeCommands)[0];
          await spin(nextCommand).start();
          this.spinnerActive = true;
          this.spinnerPaused = false;
        } else {
          this.spinnerActive = false;
          this.spinnerPaused = false;
        }
      }
    }

    this.isRenderingSpinnerUpdates = false;
  }

  public pauseSpinner(): void {
    if (this.currentSpinner && this.spinnerActive && !this.spinnerPaused) {
      this.currentSpinner.stop();
      this.spinnerPaused = true;
    }
  }

  public resumeSpinner(): void {
    if (this.spinnerPaused && this.lastSpinnerText && this.spinnerActive) {
      this.currentSpinner = new Spinner(this.lastSpinnerText);
      this.currentSpinner.start();
      this.spinnerPaused = false;
    }
  }

  async startSpinner(text: string): Promise<void> {
    if (this.spinnerActive) {
      return;
    }
    this.lastSpinnerText = text;
    this.pendingSpinnerUpdates.push({ text, type: 'start' });
    this.spinnerActive = true;
    this.spinnerPaused = false;
    await this.renderPendingSpinnerUpdates();
  }

  async stopSpinner(text?: string): Promise<void> {
    if (!this.spinnerActive) {
      return;
    }
    this.lastSpinnerText = null;
    this.pendingSpinnerUpdates.push({ text: text || 'Task completed', type: 'end' });
    this.spinnerActive = false;
    this.spinnerPaused = false;
    await this.renderPendingSpinnerUpdates();
  }

  async failSpinner(text?: string): Promise<void> {
    if (!this.spinnerActive) {
      return;
    }
    this.lastSpinnerText = null;
    this.pendingSpinnerUpdates.push({ text: text || 'Task failed', type: 'fail' });
    this.spinnerActive = false;
    this.spinnerPaused = false;
    await this.renderPendingSpinnerUpdates();
  }

  isSpinnerActive(): boolean {
    return this.spinnerActive;
  }

  isSpinnerPaused(): boolean {
    return this.spinnerPaused;
  }
}

export const terminalDisplay = new TerminalDisplay();
