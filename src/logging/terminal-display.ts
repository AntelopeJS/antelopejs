import { Spinner } from '../utils/cli-ui';

class TerminalDisplay {
  private currentSpinner?: Spinner;
  private currentSpinnerText: string | null = null;
  private spinnerActive = false;

  async cleanSpinner(): Promise<void> {
    if (this.currentSpinner) {
      await this.currentSpinner.stop();
      delete this.currentSpinner;
      this.currentSpinnerText = null;
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
    if (this.currentSpinner && this.spinnerActive) {
      await this.currentSpinner.start(this.currentSpinnerText ?? '');
    }
  }

  async startSpinner(text: string): Promise<void> {
    if (this.spinnerActive) {
      this.currentSpinner?.update(text);
    }
    this.spinnerActive = true;
    this.currentSpinnerText = text;
    this.currentSpinner = new Spinner(text);
    await this.currentSpinner.start();
  }

  async stopSpinner(text?: string): Promise<void> {
    if (!this.spinnerActive || !this.currentSpinner) return;
    if (text) {
      await this.currentSpinner.succeed(text);
    } else {
      await this.currentSpinner.stop();
    }
    await this.cleanSpinner();
  }

  async failSpinner(text?: string): Promise<void> {
    if (!this.spinnerActive || !this.currentSpinner) return;
    if (text) {
      await this.currentSpinner.fail(text);
    } else {
      await this.currentSpinner.stop();
    }
    await this.cleanSpinner();
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
