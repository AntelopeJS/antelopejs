import { expect } from 'chai';
import sinon from 'sinon';
import cmdGet from '../../../../src/core/cli/commands/config/get';
import cmdShow from '../../../../src/core/cli/commands/config/show';
import cmdSet from '../../../../src/core/cli/commands/config/set';
import cmdReset from '../../../../src/core/cli/commands/config/reset';
import * as common from '../../../../src/core/cli/common';
import * as cliUi from '../../../../src/core/cli/cli-ui';
import inquirer from 'inquirer';

describe('config commands behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('shows empty config with fallback text', async () => {
    sinon.stub(common, 'readUserConfig').resolves({} as any);
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();

    const cmd = cmdShow();
    await cmd.parseAsync(['node', 'test']);

    expect(displayStub.calledOnce).to.equal(true);
    expect(String(displayStub.firstCall.args[0])).to.include('No configuration values set');
  });

  it('fails on invalid configuration key', async () => {
    sinon.stub(common, 'readUserConfig').resolves({ git: 'https://example.com' });
    const errorStub = sinon.stub(cliUi, 'error');
    const warningStub = sinon.stub(cliUi, 'warning');

    const cmd = cmdGet();
    await cmd.parseAsync(['node', 'test', 'invalid']);

    expect(errorStub.called).to.equal(true);
    expect(warningStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('fails when valid key is missing', async () => {
    sinon.stub(common, 'readUserConfig').resolves({} as any);
    const errorStub = sinon.stub(cliUi, 'error');

    const cmd = cmdGet();
    await cmd.parseAsync(['node', 'test', 'git']);

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('displays value for valid key', async () => {
    sinon.stub(common, 'readUserConfig').resolves({ git: 'https://example.com' });
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();

    const cmd = cmdGet();
    await cmd.parseAsync(['node', 'test', 'git']);

    expect(displayStub.calledOnce).to.equal(true);
  });

  it('sets configuration value and warns on non-default git', async () => {
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
    const writeStub = sinon.stub(common, 'writeUserConfig').resolves();
    const warnStub = sinon.stub(common, 'displayNonDefaultGitWarning').resolves();
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'success');

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', 'git', 'https://example.com']);

    expect(warnStub.called).to.equal(true);
    expect(writeStub.calledOnce).to.equal(true);
  });

  it('rejects invalid key on set', async () => {
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', 'invalid', 'value']);

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('does nothing when reset has no changes', async () => {
    sinon.stub(common, 'readUserConfig').resolves(common.getDefaultUserConfig());
    const infoStub = sinon.stub(cliUi, 'info');
    const writeStub = sinon.stub(common, 'writeUserConfig').resolves();

    const cmd = cmdReset();
    await cmd.parseAsync(['node', 'test', '--yes']);

    expect(infoStub.called).to.equal(true);
    expect(writeStub.called).to.equal(false);
  });

  it('resets configuration with --yes', async () => {
    sinon.stub(common, 'readUserConfig').resolves({ git: 'https://example.com' });
    const writeStub = sinon.stub(common, 'writeUserConfig').resolves();
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'success');

    const cmd = cmdReset();
    await cmd.parseAsync(['node', 'test', '--yes']);

    expect(writeStub.calledOnce).to.equal(true);
    expect(writeStub.firstCall.args[0]).to.deep.equal(common.getDefaultUserConfig());
  });

  it('cancels reset when confirmation is declined', async () => {
    sinon.stub(common, 'readUserConfig').resolves({ git: 'https://example.com' });
    const writeStub = sinon.stub(common, 'writeUserConfig').resolves();
    sinon.stub(inquirer, 'prompt').resolves({ confirm: false });

    const cmd = cmdReset();
    await cmd.parseAsync(['node', 'test']);

    expect(writeStub.called).to.equal(false);
  });
});
