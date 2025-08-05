import { Spinner } from '../utils/cli-ui';

class TerminalDisplay {
  private currentSpinner?: Spinner;
  private currentSpinnerTexts: string[] = [];

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
      delete this.currentSpinner;
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
      delete this.currentSpinner;
      this.currentSpinnerTexts = [];
      await this.clearSpinnerLine();
    }
  }

  async pauseSpinner(): Promise<void> {
    if (this.currentSpinner) {
      await this.currentSpinner.pause();
      await this.clearSpinnerLine();
    }
  }

  async resumeSpinner(): Promise<void> {
    if (this.currentSpinner && this.currentSpinnerTexts.length > 0) {
      const lastText = this.currentSpinnerTexts[this.currentSpinnerTexts.length - 1];
      await this.currentSpinner.start(lastText);
    }
  }

  async startSpinner(text: string): Promise<void> {
    this.currentSpinnerTexts.push(text);

    if (!this.currentSpinner) {
      this.currentSpinner = new Spinner(text);
      await this.currentSpinner.start();
    } else {
      this.updateSpinnerText();
    }
  }

  async stopSpinner(text?: string): Promise<void> {
    if (!this.currentSpinner) return;

    if (text) {
      await this.currentSpinner.succeed(text);
    } else {
      await this.currentSpinner.stop();
    }

    this.currentSpinnerTexts.pop();
    this.updateSpinnerText();
  }

  async failSpinner(text?: string): Promise<void> {
    if (!this.currentSpinner) return;

    if (text) {
      await this.currentSpinner.fail(text);
    } else {
      await this.currentSpinner.stop();
    }

    this.currentSpinnerTexts.pop();
    this.updateSpinnerText();
  }

  isSpinnerActive(): boolean {
    return !!this.currentSpinner;
  }

  async clearSpinnerLine(): Promise<void> {
    if (this.currentSpinner) {
      process.stdout.write('\r\x1b[K');
      process.stderr.write('\r\x1b[K');
    }
  }
}

export const terminalDisplay = new TerminalDisplay();
