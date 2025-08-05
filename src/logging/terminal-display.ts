import { Spinner } from '../utils/cli-ui';

class TerminalDisplay {
  private currentSpinner?: Spinner;
  private currentSpinnerTexts: string[] = [];
  private spinnerActive = false;

  private updateSpinnerText(): void {
    if (this.currentSpinnerTexts.length > 0) {
      const lastText = this.currentSpinnerTexts[this.currentSpinnerTexts.length - 1];
      if (this.currentSpinner && this.spinnerActive) {
        this.currentSpinner.update(lastText);
      }
    } else {
      this.destroySpinner();
    }
  }

  private destroySpinner(): void {
    if (this.currentSpinner) {
      this.currentSpinner.stop();
      delete this.currentSpinner;
      this.spinnerActive = false;
      this.clearSpinnerLine();
    }
  }

  async cleanSpinner(): Promise<void> {
    if (this.currentSpinner) {
      await this.currentSpinner.stop();
      delete this.currentSpinner;
      this.currentSpinnerTexts = [];
      this.spinnerActive = false;
      await this.clearSpinnerLine();
    }
  }

  async pauseSpinner(): Promise<void> {
    if (this.currentSpinner && this.spinnerActive) {
      await this.currentSpinner.stop();
      await this.clearSpinnerLine();
    }
  }

  async resumeSpinner(): Promise<void> {
    if (this.currentSpinner && this.spinnerActive && this.currentSpinnerTexts.length > 0) {
      const lastText = this.currentSpinnerTexts[this.currentSpinnerTexts.length - 1];
      await this.currentSpinner.start(lastText);
    }
  }

  async startSpinner(text: string): Promise<void> {
    this.currentSpinnerTexts.push(text);

    if (!this.spinnerActive) {
      this.spinnerActive = true;
      this.currentSpinner = new Spinner(text);
      await this.currentSpinner.start();
    } else {
      this.updateSpinnerText();
    }
  }

  async stopSpinner(text?: string): Promise<void> {
    if (!this.spinnerActive || !this.currentSpinner) return;

    if (text) {
      await this.currentSpinner.succeed(text);
    } else {
      await this.currentSpinner.stop();
    }

    this.currentSpinnerTexts.pop();
    this.updateSpinnerText();
  }

  async failSpinner(text?: string): Promise<void> {
    if (!this.spinnerActive || !this.currentSpinner) return;

    if (text) {
      await this.currentSpinner.fail(text);
    } else {
      await this.currentSpinner.stop();
    }

    this.currentSpinnerTexts.pop();
    this.updateSpinnerText();
  }

  isSpinnerActive(): boolean {
    return this.spinnerActive;
  }

  async clearSpinnerLine(): Promise<void> {
    if (this.spinnerActive && this.currentSpinner) {
      process.stdout.write('\r\x1b[K');
      process.stderr.write('\r\x1b[K');
    }
  }
}

export const terminalDisplay = new TerminalDisplay();
