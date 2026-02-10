import { expect } from 'chai';
import sinon from 'sinon';
import { terminateChildProcess } from '../../../../../src/core/cli/commands/project/dev';

describe('dev command child process', () => {
  it('should send SIGTERM and resolve when child exits', async () => {
    const child = {
      kill: sinon.stub().returns(true),
      on: sinon.stub(),
      removeListener: sinon.stub(),
      pid: 1234,
    };

    child.on.withArgs('exit').callsFake((_event: string, callback: () => void) => {
      setTimeout(callback, 5);
    });

    await terminateChildProcess(child as any);

    expect(child.kill.calledWith('SIGTERM')).to.equal(true);
  });

  it('should send SIGKILL after timeout when child does not exit', async () => {
    const clock = sinon.useFakeTimers();
    const child = {
      kill: sinon.stub().returns(true),
      on: sinon.stub(),
      removeListener: sinon.stub(),
      pid: 1234,
    };

    const terminatePromise = terminateChildProcess(child as any, 100);
    clock.tick(100);

    await terminatePromise;

    expect(child.kill.calledWith('SIGTERM')).to.equal(true);
    expect(child.kill.calledWith('SIGKILL')).to.equal(true);

    clock.restore();
  });
});
