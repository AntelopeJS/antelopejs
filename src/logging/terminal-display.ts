import { Spinner } from '../utils/cli-ui';

class TerminalDisplay {
  private currentSpinner?: Spinner;
  private currentSpinnerTexts: string[] = [];
  private lastMessage: string = '';

  private updateSpinnerText(): void {
    if (this.currentSpinnerTexts.length > 0) {
      const lastText = this.currentSpinnerTexts[this.currentSpinnerTexts.length - 1];
      if (this.currentSpinner) {
        this.currentSpinner.update(lastText);
      }
    } else {
      this.destroySpinner();
    }
  }

  private destroySpinner(): void {
    if (this.currentSpinner) {
      this.currentSpinner.stop();
      this.currentSpinner = undefined;
      this.clearSpinnerLine();
    }
  }

  log(message: string): void {
    if (this.currentSpinner) {
      this.currentSpinner.log(process.stdout, message);
    }
  }

  async cleanSpinner(): Promise<void> {
    if (this.currentSpinner) {
      await this.currentSpinner.stop();
      this.currentSpinner = undefined;
      this.currentSpinnerTexts = [];
      await this.clearSpinnerLine();
    }
  }

  async startSpinner(text: string): Promise<void> {
    this.currentSpinnerTexts.push(text);
    this.lastMessage = text;

    if (!this.currentSpinner) {
      this.currentSpinner = new Spinner(text);
      await this.currentSpinner.start();
    } else {
      this.updateSpinnerText();
    }
  }

  async stopSpinner(text?: string): Promise<void> {
    if (!this.currentSpinner || this.currentSpinnerTexts.length === 0) return;

    const currentText = this.currentSpinnerTexts[this.currentSpinnerTexts.length - 1];
    const displayText = text || currentText;

    if (text) {
      await this.currentSpinner.succeed(displayText);
      this.currentSpinner = undefined;
    } else {
      await this.currentSpinner.stop();
    }

    this.currentSpinnerTexts.pop();

    if (this.currentSpinnerTexts.length > 0) {
      const nextText = this.currentSpinnerTexts[this.currentSpinnerTexts.length - 1];
      this.currentSpinner = new Spinner(nextText);
      await this.currentSpinner.start();
    } else {
      this.destroySpinner();
    }
  }

  async failSpinner(text?: string): Promise<void> {
    if (!this.currentSpinner || this.currentSpinnerTexts.length === 0) return;

    const currentText = this.currentSpinnerTexts[this.currentSpinnerTexts.length - 1];
    const displayText = text || currentText;

    await this.currentSpinner.fail(displayText);
    this.currentSpinner = undefined;
    this.currentSpinnerTexts.pop();

    if (this.currentSpinnerTexts.length > 0) {
      const nextText = this.currentSpinnerTexts[this.currentSpinnerTexts.length - 1];
      this.currentSpinner = new Spinner(nextText);
      await this.currentSpinner.start();
    } else {
      this.destroySpinner();
    }
  }

  isSpinnerActive(): boolean {
    return !!this.currentSpinner;
  }

  async clearSpinnerLine(): Promise<void> {
    if (this.currentSpinner) {
      process.stdout.write('\r\x1b[K');
    }
  }
}

export const terminalDisplay = new TerminalDisplay();
