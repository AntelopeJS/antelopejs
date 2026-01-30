import { expect, sinon } from '../../helpers/setup';
import { terminalDisplay } from '../../../src/logging/terminal-display';

describe('logging/terminal-display', () => {
  // Clean up any active spinner after each test
  afterEach(async () => {
    await terminalDisplay.cleanSpinner();
  });

  describe('terminalDisplay singleton', () => {
    it('should be defined', () => {
      expect(terminalDisplay).to.exist;
    });

    it('should have isSpinnerActive method', () => {
      expect(terminalDisplay.isSpinnerActive).to.be.a('function');
    });

    it('should have startSpinner method', () => {
      expect(terminalDisplay.startSpinner).to.be.a('function');
    });

    it('should have stopSpinner method', () => {
      expect(terminalDisplay.stopSpinner).to.be.a('function');
    });

    it('should have failSpinner method', () => {
      expect(terminalDisplay.failSpinner).to.be.a('function');
    });

    it('should have cleanSpinner method', () => {
      expect(terminalDisplay.cleanSpinner).to.be.a('function');
    });

    it('should have log method', () => {
      expect(terminalDisplay.log).to.be.a('function');
    });

    it('should have clearSpinnerLine method', () => {
      expect(terminalDisplay.clearSpinnerLine).to.be.a('function');
    });
  });

  describe('spinner state', () => {
    it('should return false for isSpinnerActive when no spinner', () => {
      expect(terminalDisplay.isSpinnerActive()).to.be.false;
    });
  });

  describe('log method', () => {
    it('should not throw when called without spinner', () => {
      expect(() => terminalDisplay.log('test message')).to.not.throw();
    });
  });

  describe('startSpinner', () => {
    it('should start a spinner with text', async () => {
      await terminalDisplay.startSpinner('Loading...');
      expect(terminalDisplay.isSpinnerActive()).to.be.true;
    });

    it('should handle nested spinners', async () => {
      await terminalDisplay.startSpinner('First');
      expect(terminalDisplay.isSpinnerActive()).to.be.true;
      await terminalDisplay.startSpinner('Second');
      expect(terminalDisplay.isSpinnerActive()).to.be.true;
    });
  });

  describe('stopSpinner', () => {
    it('should not throw when called without active spinner', async () => {
      await terminalDisplay.stopSpinner();
    });

    it('should not throw when called with text without active spinner', async () => {
      await terminalDisplay.stopSpinner('completed');
    });

    it('should stop active spinner', async () => {
      await terminalDisplay.startSpinner('Loading');
      await terminalDisplay.stopSpinner('Done');
      expect(terminalDisplay.isSpinnerActive()).to.be.false;
    });

    it('should stop without text', async () => {
      await terminalDisplay.startSpinner('Loading');
      await terminalDisplay.stopSpinner();
      expect(terminalDisplay.isSpinnerActive()).to.be.false;
    });

    it('should handle nested spinner stop', async () => {
      await terminalDisplay.startSpinner('First');
      await terminalDisplay.startSpinner('Second');
      await terminalDisplay.stopSpinner('Second done');
      // First spinner should still be active (re-created)
      expect(terminalDisplay.isSpinnerActive()).to.be.true;
      await terminalDisplay.stopSpinner('First done');
      expect(terminalDisplay.isSpinnerActive()).to.be.false;
    });
  });

  describe('failSpinner', () => {
    it('should not throw when called without active spinner', async () => {
      await terminalDisplay.failSpinner();
    });

    it('should not throw when called with text without active spinner', async () => {
      await terminalDisplay.failSpinner('failed');
    });

    it('should fail active spinner', async () => {
      await terminalDisplay.startSpinner('Loading');
      await terminalDisplay.failSpinner('Error occurred');
      expect(terminalDisplay.isSpinnerActive()).to.be.false;
    });

    it('should fail without text', async () => {
      await terminalDisplay.startSpinner('Loading');
      await terminalDisplay.failSpinner();
      expect(terminalDisplay.isSpinnerActive()).to.be.false;
    });

    it('should handle nested spinner fail', async () => {
      await terminalDisplay.startSpinner('First');
      await terminalDisplay.startSpinner('Second');
      await terminalDisplay.failSpinner('Second failed');
      // First spinner should still be active (re-created)
      expect(terminalDisplay.isSpinnerActive()).to.be.true;
    });
  });

  describe('cleanSpinner', () => {
    it('should not throw when called without active spinner', async () => {
      await terminalDisplay.cleanSpinner();
    });

    it('should clean active spinner', async () => {
      await terminalDisplay.startSpinner('Loading');
      await terminalDisplay.cleanSpinner();
      expect(terminalDisplay.isSpinnerActive()).to.be.false;
    });

    it('should clean all nested spinners', async () => {
      await terminalDisplay.startSpinner('First');
      await terminalDisplay.startSpinner('Second');
      await terminalDisplay.cleanSpinner();
      expect(terminalDisplay.isSpinnerActive()).to.be.false;
    });
  });

  describe('clearSpinnerLine', () => {
    it('should not throw when called', async () => {
      await terminalDisplay.clearSpinnerLine();
    });

    it('should not throw when spinner is active', async () => {
      await terminalDisplay.startSpinner('Loading');
      await terminalDisplay.clearSpinnerLine();
    });
  });

  describe('log with active spinner', () => {
    it('should log message when spinner is active', async () => {
      await terminalDisplay.startSpinner('Loading');
      expect(() => terminalDisplay.log('Progress update')).to.not.throw();
    });
  });
});
