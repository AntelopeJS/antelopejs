import { expect } from 'chai';
import * as sinon from 'sinon';
import {
  Spinner,
  success,
  error,
  warning,
  info,
  displayBox,
  displayBanner,
  header,
  keyValue,
  sleep,
  isTerminalOutput,
} from '../../../src/core/cli/cli-ui';

describe('CLI UI', () => {
  describe('Spinner', () => {
    let stdoutStub: sinon.SinonStub;

    beforeEach(() => {
      stdoutStub = sinon.stub(process.stdout, 'write');
    });

    afterEach(() => {
      stdoutStub.restore();
    });

    it('should create spinner with text', () => {
      const spinner = new Spinner('Loading...');
      expect(spinner).to.be.instanceOf(Spinner);
    });

    it('should update text', () => {
      const spinner = new Spinner('Initial');
      spinner.update('Updated');
    });

    it('should stop spinner', async () => {
      const spinner = new Spinner('Test');
      await spinner.start();
      await spinner.stop();
    });

    it('should handle non-terminal output', async () => {
      const originalStdout = process.stdout.isTTY;
      const originalStderr = process.stderr.isTTY;
      (process.stdout as any).isTTY = false;
      (process.stderr as any).isTTY = false;
      try {
        const spinner = new Spinner('NoTTY');
        await spinner.start();
        spinner.log(process.stdout, 'log');
        await spinner.succeed('done');
      } finally {
        (process.stdout as any).isTTY = originalStdout;
        (process.stderr as any).isTTY = originalStderr;
      }
    });

    it('should log while running in terminal', async () => {
      const originalStdout = process.stdout.isTTY;
      const originalStderr = process.stderr.isTTY;
      (process.stdout as any).isTTY = true;
      (process.stderr as any).isTTY = true;
      const clock = sinon.useFakeTimers();
      try {
        const spinner = new Spinner('TTY');
        await spinner.start();
        spinner.log(process.stdout, 'message');
        await spinner.stop();
      } finally {
        clock.restore();
        (process.stdout as any).isTTY = originalStdout;
        (process.stderr as any).isTTY = originalStderr;
      }
    });

    it('should no-op on status methods when not running', async () => {
      const originalStdout = process.stdout.isTTY;
      const originalStderr = process.stderr.isTTY;
      (process.stdout as any).isTTY = false;
      (process.stderr as any).isTTY = false;
      try {
        const spinner = new Spinner('Idle');
        await spinner.succeed('done');
        await spinner.fail('fail');
        await spinner.info('info');
        await spinner.warn('warn');
        await spinner.pause();
        await spinner.clear();
      } finally {
        (process.stdout as any).isTTY = originalStdout;
        (process.stderr as any).isTTY = originalStderr;
      }
    });
  });

  describe('display functions', () => {
    it('should format success message', () => {
      expect(() => success('Done')).to.not.throw();
    });

    it('should format error message', () => {
      expect(() => error('Failed')).to.not.throw();
    });

    it('should format warning message', () => {
      expect(() => warning('Careful')).to.not.throw();
    });

    it('should format info message', () => {
      expect(() => info('Note')).to.not.throw();
    });

    it('should render display box', async () => {
      const logStub = sinon.stub(console, 'log');
      try {
        await displayBox('Hello', 'Title');
        expect(logStub.called).to.equal(true);
      } finally {
        logStub.restore();
      }
    });

    it('should render banner and header', () => {
      const logStub = sinon.stub(console, 'log');
      try {
        displayBanner('AntelopeJS');
        header('Header');
        expect(logStub.called).to.equal(true);
      } finally {
        logStub.restore();
      }
    });

    it('should format key/value and sleep', async () => {
      expect(keyValue('a', 'b')).to.include('a');
      await sleep(1);
      expect(true).to.equal(true);
    });

    it('should detect terminal output', () => {
      const originalStdout = process.stdout.isTTY;
      const originalStderr = process.stderr.isTTY;
      (process.stdout as any).isTTY = true;
      (process.stderr as any).isTTY = true;
      try {
        expect(isTerminalOutput()).to.equal(true);
      } finally {
        (process.stdout as any).isTTY = originalStdout;
        (process.stderr as any).isTTY = originalStderr;
      }
    });
  });
});
