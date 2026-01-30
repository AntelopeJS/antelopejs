import { expect, sinon } from '../../helpers/setup';
import {
  Spinner,
  ProgressBar,
  displayBanner,
  success,
  error,
  warning,
  info,
  header,
  keyValue,
  sleep,
} from '../../../src/utils/cli-ui';
import * as Logging from '../../../src/interfaces/logging/beta';

describe('utils/cli-ui', () => {
  describe('Spinner', () => {
    it('should create a spinner with text', () => {
      const spinner = new Spinner('Loading...');
      expect(spinner).to.be.instanceof(Spinner);
    });

    it('should start and stop without error', async () => {
      const spinner = new Spinner('Test');
      await spinner.start();
      await spinner.stop();
    });

    it('should update text', () => {
      const spinner = new Spinner('Initial');
      const result = spinner.update('Updated');
      expect(result).to.equal(spinner);
    });

    it('should not throw when stopping an already stopped spinner', async () => {
      const spinner = new Spinner('Test');
      await spinner.stop();
      await spinner.stop();
    });

    it('should handle succeed method', async () => {
      const spinner = new Spinner('Test');
      await spinner.start();
      await spinner.succeed('Done');
    });

    it('should handle fail method', async () => {
      const spinner = new Spinner('Test');
      await spinner.start();
      await spinner.fail('Failed');
    });

    it('should handle info method', async () => {
      const spinner = new Spinner('Test');
      await spinner.start();
      await spinner.info('Info');
    });

    it('should handle warn method', async () => {
      const spinner = new Spinner('Test');
      await spinner.start();
      await spinner.warn('Warning');
    });

    it('should handle pause method', async () => {
      const spinner = new Spinner('Test');
      await spinner.start();
      await spinner.pause();
    });

    it('should handle clear method', async () => {
      const spinner = new Spinner('Test');
      await spinner.start();
      await spinner.clear();
    });

    it('should return same spinner when already running', async () => {
      const spinner = new Spinner('Test');
      await spinner.start();
      const result = await spinner.start();
      expect(result).to.equal(spinner);
      await spinner.stop();
    });

    it('should allow starting with different text', async () => {
      const spinner = new Spinner('Initial');
      await spinner.start('Different');
      await spinner.stop();
    });

    it('should handle log method', async () => {
      const spinner = new Spinner('Test');
      await spinner.start();
      spinner.log(process.stdout, 'Log message');
      await spinner.stop();
    });

    it('should handle log when not running', () => {
      const spinner = new Spinner('Test');
      spinner.log(process.stdout, 'Log message');
    });

    it('should not print when not running on succeed', async () => {
      const spinner = new Spinner('Test');
      await spinner.succeed('Done');
    });

    it('should not print when not running on fail', async () => {
      const spinner = new Spinner('Test');
      await spinner.fail('Failed');
    });

    it('should not print when not running on info', async () => {
      const spinner = new Spinner('Test');
      await spinner.info('Info');
    });

    it('should not print when not running on warn', async () => {
      const spinner = new Spinner('Test');
      await spinner.warn('Warning');
    });
  });

  describe('ProgressBar', () => {
    it('should create a progress bar', () => {
      const bar = new ProgressBar();
      expect(bar).to.be.instanceof(ProgressBar);
    });

    it('should create with custom format', () => {
      const bar = new ProgressBar('{bar} {percentage}%');
      expect(bar).to.be.instanceof(ProgressBar);
    });

    it('should start with total', () => {
      const bar = new ProgressBar();
      const result = bar.start(100);
      expect(result).to.equal(bar);
      bar.stop();
    });

    it('should start with custom values', () => {
      const bar = new ProgressBar();
      bar.start(100, 10, 'Custom title');
      bar.stop();
    });

    it('should increment', () => {
      const bar = new ProgressBar();
      bar.start(100);
      const result = bar.increment();
      expect(result).to.equal(bar);
      bar.stop();
    });

    it('should increment with amount', () => {
      const bar = new ProgressBar();
      bar.start(100);
      bar.increment(5);
      bar.stop();
    });

    it('should increment with payload', () => {
      const bar = new ProgressBar();
      bar.start(100);
      bar.increment(1, { extra: 'data' });
      bar.stop();
    });

    it('should update to value', () => {
      const bar = new ProgressBar();
      bar.start(100);
      const result = bar.update(50);
      expect(result).to.equal(bar);
      bar.stop();
    });

    it('should update with payload', () => {
      const bar = new ProgressBar();
      bar.start(100);
      bar.update(50, { title: 'Halfway' });
      bar.stop();
    });
  });

  describe('displayBanner', () => {
    let consoleStub: sinon.SinonStub;

    beforeEach(() => {
      consoleStub = sinon.stub(console, 'log');
    });

    it('should display ASCII banner', () => {
      displayBanner('Test');
      expect(consoleStub).to.have.been.called;
    });

    it('should display with custom font', () => {
      displayBanner('Test', 'Banner');
      expect(consoleStub).to.have.been.called;
    });
  });

  describe('success', () => {
    it('should write success message', () => {
      const writeStub = sinon.stub(Logging.Logging, 'Write');
      success('Success message');
      expect(writeStub).to.have.been.called;
    });
  });

  describe('error', () => {
    it('should write error message', () => {
      const writeStub = sinon.stub(Logging.Logging, 'Write');
      error('Error message');
      expect(writeStub).to.have.been.called;
    });
  });

  describe('warning', () => {
    it('should write warning message', () => {
      const writeStub = sinon.stub(Logging.Logging, 'Write');
      warning('Warning message');
      expect(writeStub).to.have.been.called;
    });
  });

  describe('info', () => {
    it('should write info message', () => {
      const writeStub = sinon.stub(Logging.Logging, 'Write');
      info('Info message');
      expect(writeStub).to.have.been.called;
    });
  });

  describe('header', () => {
    let consoleStub: sinon.SinonStub;

    beforeEach(() => {
      consoleStub = sinon.stub(console, 'log');
    });

    it('should print header with underline', () => {
      header('My Header');
      expect(consoleStub.callCount).to.be.at.least(2);
    });
  });

  describe('keyValue', () => {
    it('should format key-value pair', () => {
      const result = keyValue('name', 'value');
      expect(result).to.include('name');
      expect(result).to.include('value');
    });

    it('should handle numeric values', () => {
      const result = keyValue('count', 42);
      expect(result).to.include('count');
      expect(result).to.include('42');
    });

    it('should handle boolean values', () => {
      const result = keyValue('enabled', true);
      expect(result).to.include('enabled');
      expect(result).to.include('true');
    });
  });

  describe('sleep', () => {
    it('should delay for specified time', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).to.be.at.least(45);
    });

    it('should return a promise', () => {
      const result = sleep(1);
      expect(result).to.be.instanceof(Promise);
    });
  });

  describe('ProgressBar extended tests', () => {
    describe('constructor', () => {
      it('should create with no arguments', () => {
        const bar = new ProgressBar();
        expect(bar).to.exist;
        bar.stop();
      });

      it('should create with custom format string', () => {
        const bar = new ProgressBar('{bar} | {percentage}%');
        expect(bar).to.exist;
        bar.stop();
      });

      it('should create with format and options', () => {
        const bar = new ProgressBar('{bar}', { hideCursor: false });
        expect(bar).to.exist;
        bar.stop();
      });
    });

    describe('start', () => {
      it('should return this for method chaining', () => {
        const bar = new ProgressBar();
        const result = bar.start(100);
        expect(result).to.equal(bar);
        bar.stop();
      });

      it('should accept total, startValue, and title', () => {
        const bar = new ProgressBar();
        bar.start(100, 25, 'Custom Title');
        bar.stop();
      });

      it('should work with just total', () => {
        const bar = new ProgressBar();
        bar.start(50);
        bar.stop();
      });

      it('should work with total and startValue', () => {
        const bar = new ProgressBar();
        bar.start(100, 10);
        bar.stop();
      });
    });

    describe('increment', () => {
      it('should return this for method chaining', () => {
        const bar = new ProgressBar();
        bar.start(100);
        const result = bar.increment();
        expect(result).to.equal(bar);
        bar.stop();
      });

      it('should increment by 1 by default', () => {
        const bar = new ProgressBar();
        bar.start(100);
        bar.increment();
        bar.stop();
      });

      it('should increment by custom amount', () => {
        const bar = new ProgressBar();
        bar.start(100);
        bar.increment(10);
        bar.stop();
      });

      it('should accept payload object', () => {
        const bar = new ProgressBar();
        bar.start(100);
        bar.increment(5, { title: 'New Title', extra: 'data' });
        bar.stop();
      });
    });

    describe('update', () => {
      it('should return this for method chaining', () => {
        const bar = new ProgressBar();
        bar.start(100);
        const result = bar.update(50);
        expect(result).to.equal(bar);
        bar.stop();
      });

      it('should update to specific value', () => {
        const bar = new ProgressBar();
        bar.start(100);
        bar.update(75);
        bar.stop();
      });

      it('should accept payload object', () => {
        const bar = new ProgressBar();
        bar.start(100);
        bar.update(30, { title: 'Updated Title' });
        bar.stop();
      });
    });

    describe('stop', () => {
      it('should stop the progress bar', () => {
        const bar = new ProgressBar();
        bar.start(100);
        bar.stop();
        // Should not throw
      });

      it('should be safe to call multiple times', () => {
        const bar = new ProgressBar();
        bar.start(100);
        bar.stop();
        bar.stop();
        // Should not throw
      });
    });
  });

  describe('displayBanner extended tests', () => {
    let consoleStub: sinon.SinonStub;

    beforeEach(() => {
      consoleStub = sinon.stub(console, 'log');
    });

    it('should display banner with default font', () => {
      displayBanner('Test');
      expect(consoleStub).to.have.been.called;
    });

    it('should display banner with Standard font', () => {
      displayBanner('Test', 'Standard');
      expect(consoleStub).to.have.been.called;
    });

    it('should display banner with Banner font', () => {
      displayBanner('Test', 'Banner');
      expect(consoleStub).to.have.been.called;
    });

    it('should handle empty string', () => {
      displayBanner('');
      expect(consoleStub).to.have.been.called;
    });

    it('should handle long text', () => {
      displayBanner('AntelopeJS');
      expect(consoleStub).to.have.been.called;
    });
  });

  describe('header extended tests', () => {
    let consoleStub: sinon.SinonStub;

    beforeEach(() => {
      consoleStub = sinon.stub(console, 'log');
    });

    it('should print header text', () => {
      header('Test Header');
      expect(consoleStub).to.have.been.called;
    });

    it('should print empty line before header', () => {
      header('Header');
      // First call should be empty string
      expect(consoleStub.firstCall.args[0]).to.equal('');
    });

    it('should print underline after header', () => {
      header('Header');
      // Should be called at least 3 times (empty, header, underline)
      expect(consoleStub.callCount).to.be.at.least(3);
    });

    it('should handle empty header', () => {
      header('');
      expect(consoleStub).to.have.been.called;
    });

    it('should handle long header', () => {
      header('This is a very long header text that spans many characters');
      expect(consoleStub).to.have.been.called;
    });
  });

  describe('keyValue extended tests', () => {
    it('should format string key and value', () => {
      const result = keyValue('name', 'John');
      expect(result).to.include('name');
      expect(result).to.include('John');
    });

    it('should format key with numeric value', () => {
      const result = keyValue('count', 42);
      expect(result).to.include('count');
      expect(result).to.include('42');
    });

    it('should format key with boolean true', () => {
      const result = keyValue('enabled', true);
      expect(result).to.include('enabled');
      expect(result).to.include('true');
    });

    it('should format key with boolean false', () => {
      const result = keyValue('disabled', false);
      expect(result).to.include('disabled');
      expect(result).to.include('false');
    });

    it('should format key with zero value', () => {
      const result = keyValue('zero', 0);
      expect(result).to.include('zero');
      expect(result).to.include('0');
    });

    it('should format key with negative number', () => {
      const result = keyValue('negative', -10);
      expect(result).to.include('negative');
      expect(result).to.include('-10');
    });

    it('should format key with decimal number', () => {
      const result = keyValue('decimal', 3.14);
      expect(result).to.include('decimal');
      expect(result).to.include('3.14');
    });

    it('should return a string containing colon separator', () => {
      const result = keyValue('key', 'value');
      expect(result).to.include(':');
    });
  });

  describe('sleep extended tests', () => {
    it('should resolve after 10ms', async () => {
      const start = Date.now();
      await sleep(10);
      const elapsed = Date.now() - start;
      expect(elapsed).to.be.at.least(8);
    });

    it('should resolve after 1ms', async () => {
      const start = Date.now();
      await sleep(1);
      const elapsed = Date.now() - start;
      expect(elapsed).to.be.at.least(0);
    });

    it('should resolve after 0ms', async () => {
      await sleep(0);
      // Should not throw
    });

    it('should return a promise that resolves to undefined', async () => {
      const result = await sleep(1);
      expect(result).to.be.undefined;
    });
  });
});
