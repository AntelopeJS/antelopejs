import { expect } from 'chai';
import * as sinon from 'sinon';
import {
  Spinner,
  ProgressBar,
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
import cliProgress from 'cli-progress';

describe('CLI UI', () => {
  describe('Spinner', () => {
    it('runs and logs in non-terminal mode', async () => {
      const originalStdout = process.stdout.isTTY;
      const originalStderr = process.stderr.isTTY;
      const writeStub = sinon.stub(process.stdout, 'write');
      const logStub = sinon.stub(console, 'log');

      (process.stdout as any).isTTY = false;
      (process.stderr as any).isTTY = false;

      try {
        const spinner = new Spinner('Running');
        await spinner.start();
        spinner.log(process.stdout, 'step');
        await spinner.succeed('done');
        expect(writeStub.called).to.equal(true);
        expect(logStub.called).to.equal(true);
      } finally {
        writeStub.restore();
        logStub.restore();
        (process.stdout as any).isTTY = originalStdout;
        (process.stderr as any).isTTY = originalStderr;
      }
    });

    it('updates and stops in terminal mode', async () => {
      const originalStdout = process.stdout.isTTY;
      const originalStderr = process.stderr.isTTY;
      const writeStub = sinon.stub(process.stdout, 'write');
      const clock = sinon.useFakeTimers();

      (process.stdout as any).isTTY = true;
      (process.stderr as any).isTTY = true;

      try {
        const spinner = new Spinner('Start');
        await spinner.start();
        spinner.update('Updated');
        clock.tick(200);
        await spinner.stop();
        expect(writeStub.called).to.equal(true);
      } finally {
        clock.restore();
        writeStub.restore();
        (process.stdout as any).isTTY = originalStdout;
        (process.stderr as any).isTTY = originalStderr;
      }
    });

    it('handles status methods when not running', async () => {
      const spinner = new Spinner('Idle');
      await spinner.succeed();
      await spinner.fail();
      await spinner.info();
      await spinner.warn();
      await spinner.pause();
      await spinner.clear();
      expect(true).to.equal(true);
    });
  });

  describe('ProgressBar', () => {
    it('increments progress', () => {
      const incrementStub = sinon.stub(cliProgress.SingleBar.prototype, 'increment');
      const bar = new ProgressBar();
      bar.increment(2, { title: 'x' });
      expect(incrementStub.calledOnce).to.equal(true);
      incrementStub.restore();
    });
  });

  describe('Display', () => {
    it('formats messages', () => {
      expect(() => success('Done')).to.not.throw();
      expect(() => error('Failed')).to.not.throw();
      expect(() => warning('Careful')).to.not.throw();
      expect(() => info('Note')).to.not.throw();
    });

    it('renders box, banner and header', async () => {
      const logStub = sinon.stub(console, 'log');
      try {
        await displayBox('Hello', 'Title');
        displayBanner('AntelopeJS');
        header('Header');
        expect(logStub.called).to.equal(true);
      } finally {
        logStub.restore();
      }
    });

    it('formats key/value and supports sleep', async () => {
      expect(keyValue('a', 'b')).to.include('a');
      await sleep(1);
      expect(true).to.equal(true);
    });

    it('detects terminal output', () => {
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
