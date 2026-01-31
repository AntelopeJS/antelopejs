import { expect } from 'chai';
import { TerminalDisplay } from '../../../src/core/cli/terminal-display';

describe('TerminalDisplay', () => {
  let display: TerminalDisplay;

  beforeEach(() => {
    display = new TerminalDisplay();
  });

  it('should manage nested spinners', async () => {
    await display.startSpinner('Outer');
    await display.startSpinner('Inner');
    await display.stopSpinner('Inner done');
    await display.stopSpinner('Outer done');
  });

  it('should track spinner state', () => {
    expect(display.isSpinnerActive()).to.be.false;
  });
});
