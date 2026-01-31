import { expect } from 'chai';
import sinon from 'sinon';
import { warnIfOutdated } from '../../../src/core/cli/version-check';
import * as cliUi from '../../../src/core/cli/cli-ui';

describe('Version Check', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should not throw on network error', async () => {
    const failingExec = () => {
      throw new Error('network error');
    };
    await warnIfOutdated('0.0.1', failingExec);
    expect(true).to.equal(true);
  });

  it('warns when newer version is available', async () => {
    const warnStub = sinon.stub(cliUi, 'warning');
    const execStub = () => Buffer.from('2.0.0');

    await warnIfOutdated('1.0.0', execStub);

    expect(warnStub.callCount).to.equal(3);
  });

  it('does not warn when up to date', async () => {
    const warnStub = sinon.stub(cliUi, 'warning');
    const execStub = () => Buffer.from('1.0.0');

    await warnIfOutdated('1.0.0', execStub);

    expect(warnStub.called).to.equal(false);
  });

  it('handles non-Error failures', async () => {
    const infoStub = sinon.stub(cliUi, 'info');
    const execStub = () => {
      throw 'boom';
    };

    await warnIfOutdated('0.0.1', execStub);

    expect(infoStub.called).to.equal(true);
  });
});
