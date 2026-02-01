import { expect } from 'chai';
import sinon from 'sinon';
import { TerminalDisplay } from '../../../src/core/cli/terminal-display';
import { Spinner } from '../../../src/core/cli/cli-ui';

describe('TerminalDisplay', () => {
  let display: TerminalDisplay;

  beforeEach(() => {
    display = new TerminalDisplay();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should manage nested spinners', async () => {
    sinon.stub(Spinner.prototype, 'start').resolves();
    sinon.stub(Spinner.prototype, 'stop').resolves();
    sinon.stub(Spinner.prototype, 'succeed').resolves();
    await display.startSpinner('Outer');
    await display.startSpinner('Inner');
    await display.stopSpinner('Inner done');
    await display.stopSpinner('Outer done');
  });

  it('should track spinner state', () => {
    expect(display.isSpinnerActive()).to.be.false;
  });

  it('should log through active spinner', async () => {
    const logStub = sinon.stub(Spinner.prototype, 'log');
    sinon.stub(Spinner.prototype, 'start').resolves();
    sinon.stub(Spinner.prototype, 'succeed').resolves();

    await display.startSpinner('Working');
    display.log('hello');
    await display.stopSpinner('done');

    expect(logStub.calledOnce).to.equal(true);
  });

  it('should stop spinner without success text and restart parent', async () => {
    const startStub = sinon.stub(Spinner.prototype, 'start').resolves();
    const stopStub = sinon.stub(Spinner.prototype, 'stop').resolves();

    await display.startSpinner('Outer');
    await display.startSpinner('Inner');
    await display.stopSpinner();

    expect(stopStub.called).to.equal(true);
    expect(startStub.callCount).to.equal(2);
  });

  it('should fail and clear last spinner', async () => {
    const failStub = sinon.stub(Spinner.prototype, 'fail').resolves();
    sinon.stub(Spinner.prototype, 'start').resolves();

    await display.startSpinner('Task');
    await display.failSpinner('boom');

    expect(failStub.calledOnce).to.equal(true);
  });

  it('should clean spinner state', async () => {
    const stopStub = sinon.stub(Spinner.prototype, 'stop').resolves();
    sinon.stub(Spinner.prototype, 'start').resolves();
    const writeStub = sinon.stub(process.stdout, 'write');

    await display.startSpinner('Task');
    await display.cleanSpinner();

    expect(stopStub.calledOnce).to.equal(true);
    expect(writeStub.called).to.equal(false);
  });

  it('should not clear line when no spinner exists', async () => {
    const writeStub = sinon.stub(process.stdout, 'write');
    await display.clearSpinnerLine();
    expect(writeStub.called).to.equal(false);
  });

  it('should clear line when spinner exists', async () => {
    sinon.stub(Spinner.prototype, 'start').resolves();
    const writeStub = sinon.stub(process.stdout, 'write');
    await display.startSpinner('Task');
    await display.clearSpinnerLine();
    expect(writeStub.called).to.equal(true);
  });

  it('should ignore stop when no spinner is active', async () => {
    const stopStub = sinon.stub(Spinner.prototype, 'stop').resolves();
    await display.stopSpinner();
    expect(stopStub.called).to.equal(false);
  });

  it('should ignore fail when no spinner is active', async () => {
    const failStub = sinon.stub(Spinner.prototype, 'fail').resolves();
    await display.failSpinner();
    expect(failStub.called).to.equal(false);
  });

  it('should not log without an active spinner', () => {
    const logStub = sinon.stub(Spinner.prototype, 'log');
    display.log('hello');
    expect(logStub.called).to.equal(false);
  });

  it('should clean without side effects when no spinner exists', async () => {
    const writeStub = sinon.stub(process.stdout, 'write');
    await display.cleanSpinner();
    expect(writeStub.called).to.equal(false);
  });
});
