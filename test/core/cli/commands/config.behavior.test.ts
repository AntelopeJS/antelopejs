import { expect } from 'chai';
import sinon from 'sinon';
import cmdShow from '../../../../src/core/cli/commands/config/show';
import cmdGet from '../../../../src/core/cli/commands/config/get';
import cmdSet from '../../../../src/core/cli/commands/config/set';
import cmdReset from '../../../../src/core/cli/commands/config/reset';
import * as common from '../../../../src/core/cli/common';
import * as cliUi from '../../../../src/core/cli/cli-ui';

describe('Config command behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('show renders configuration box', async () => {
    sinon.stub(common, 'readUserConfig').resolves({ git: 'https://example.com' });
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(console, 'log');

    const cmd = cmdShow();
    await cmd.parseAsync(['node', 'test']);

    expect(displayStub.calledOnce).to.equal(true);
  });

  it('get fails on invalid key', async () => {
    sinon.stub(common, 'readUserConfig').resolves({ git: 'https://example.com' });
    const errorStub = sinon.stub(cliUi, 'error');
    const warningStub = sinon.stub(cliUi, 'warning');
    sinon.stub(console, 'log');

    const cmd = cmdGet();
    await cmd.parseAsync(['node', 'test', 'invalid']);

    expect(errorStub.called).to.equal(true);
    expect(warningStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('get renders configuration value', async () => {
    sinon.stub(common, 'readUserConfig').resolves({ git: 'https://example.com' });
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(console, 'log');

    const cmd = cmdGet();
    await cmd.parseAsync(['node', 'test', 'git']);

    expect(displayStub.calledOnce).to.equal(true);
    expect(process.exitCode).to.equal(undefined);
  });

  it('set fails on invalid key', async () => {
    sinon.stub(common, 'readUserConfig').resolves({ git: 'https://example.com' });
    sinon.stub(common, 'writeUserConfig').resolves();
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(console, 'log');

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', 'invalid', 'value']);

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('set updates git config and warns on non-default repo', async () => {
    const config = { git: common.DEFAULT_GIT_REPO };
    const readStub = sinon.stub(common, 'readUserConfig').resolves({ ...config });
    const writeStub = sinon.stub(common, 'writeUserConfig').resolves();
    const warnStub = sinon.stub(common, 'displayNonDefaultGitWarning').resolves();
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');
    sinon.stub(console, 'log');

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', 'git', 'https://example.com/custom.git']);

    expect(readStub.calledOnce).to.equal(true);
    expect(warnStub.calledOnce).to.equal(true);
    expect(writeStub.calledOnce).to.equal(true);
    expect(displayStub.calledOnce).to.equal(true);
  });

  it('reset no-ops when config already default', async () => {
    const defaultConfig = common.getDefaultUserConfig();
    sinon.stub(common, 'readUserConfig').resolves({ ...defaultConfig });
    const infoStub = sinon.stub(cliUi, 'info');
    sinon.stub(console, 'log');

    const cmd = cmdReset();
    await cmd.parseAsync(['node', 'test', '--yes']);

    expect(infoStub.called).to.equal(true);
  });

  it('reset writes default config when changes exist', async () => {
    sinon.stub(common, 'readUserConfig').resolves({ git: 'https://example.com' });
    const writeStub = sinon.stub(common, 'writeUserConfig').resolves();
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    const successStub = sinon.stub(cliUi, 'success');
    sinon.stub(console, 'log');

    const cmd = cmdReset();
    await cmd.parseAsync(['node', 'test', '--yes']);

    expect(writeStub.calledOnce).to.equal(true);
    expect(displayStub.calledOnce).to.equal(true);
    expect(successStub.calledOnce).to.equal(true);
  });
});
