import { expect } from 'chai';
import sinon from 'sinon';
import { Command } from 'commander';
import fs from 'fs';
import * as cliUi from '../../../src/core/cli/cli-ui';
import * as versionCheck from '../../../src/core/cli/version-check';
import * as logging from '../../../src/logging';
import { runCLI } from '../../../src/core/cli';

describe('runCLI behavior', () => {
  const originalArgv = process.argv.slice();

  afterEach(() => {
    process.argv = originalArgv.slice();
    sinon.restore();
  });

  function stubCommon() {
    sinon.stub(fs, 'readFileSync').returns(JSON.stringify({ version: '0.0.0' }));
    sinon.stub(logging, 'setupAntelopeProjectLogging');
    sinon.stub(versionCheck, 'warnIfOutdated').resolves();
    sinon.stub(Command.prototype, 'parseAsync').resolves();
    sinon.stub(Command.prototype, 'getOptionValue').returns(undefined);
    sinon.stub(cliUi, 'displayBanner');
  }

  it('displays banner when no args are provided', async () => {
    process.argv = ['node', 'ajs'];
    stubCommon();

    await runCLI();

    expect((cliUi.displayBanner as sinon.SinonStub).calledOnce).to.equal(true);
  });

  it('adds channel filters when verbose is set', async () => {
    process.argv = ['node', 'ajs', '--verbose', 'core'];
    stubCommon();

    const getOptionStub = sinon.stub(Command.prototype, 'getOptionValue');
    getOptionStub.returns(['core', 'cli']);

    const addFilterStub = sinon.stub(logging, 'addChannelFilter');

    await runCLI();

    expect(addFilterStub.calledWith('core', 0)).to.equal(true);
    expect(addFilterStub.calledWith('cli', 0)).to.equal(true);
  });

  it('exits when ExitPromptError is thrown', async () => {
    process.argv = ['node', 'ajs'];
    sinon.stub(fs, 'readFileSync').returns(JSON.stringify({ version: '0.0.0' }));
    sinon.stub(logging, 'setupAntelopeProjectLogging');
    sinon.stub(versionCheck, 'warnIfOutdated').resolves();
    sinon.stub(cliUi, 'displayBanner');
    sinon.stub(Command.prototype, 'parseAsync').rejects({ name: 'ExitPromptError' });
    sinon.stub(Command.prototype, 'getOptionValue').returns(undefined);

    const exitStub = sinon.stub(process, 'exit');

    let thrown: unknown;
    try {
      await runCLI();
    } catch (err) {
      thrown = err;
    }

    expect(exitStub.calledWith(0)).to.equal(true);
    expect((thrown as any)?.name).to.equal('ExitPromptError');
  });
});
