import { expect } from 'chai';
import sinon from 'sinon';
import cmdBuild from '../../../../../src/core/cli/commands/project/build';
import cmdStart from '../../../../../src/core/cli/commands/project/start';
import * as common from '../../../../../src/core/cli/common';
import * as cliUi from '../../../../../src/core/cli/cli-ui';
import * as indexModule from '../../../../../src/index';
import * as buildArtifactModule from '../../../../../src/core/build/build-artifact';

describe('project build/start behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  function stubProjectSpinners(): void {
    sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
  }

  it('fails build when project config is missing', async () => {
    sinon.stub(common, 'readConfig').resolves(undefined);
    stubProjectSpinners();

    const cmd = cmdBuild();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(process.exitCode).to.equal(1);
  });

  it('runs build command and reports summary', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'project' } as any);
    const buildStub = sinon.stub(indexModule, 'build').resolves();
    sinon.stub(buildArtifactModule, 'readBuildArtifact').resolves({
      modules: {
        alpha: {} as any,
        beta: {} as any,
      },
    } as any);

    stubProjectSpinners();
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    const successStub = sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');

    const cmd = cmdBuild();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--env', 'production']);

    expect(buildStub.calledWith('/tmp/project', 'production', sinon.match.object)).to.equal(true);
    expect(successStub.called).to.equal(true);
  });

  it('runs start command from build artifact', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'project' } as any);
    const startStub = sinon.stub(indexModule, 'launchFromBuild').resolves({} as any);

    stubProjectSpinners();
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'error');

    const cmd = cmdStart();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--env', 'production', '--concurrency', '3']);

    expect(startStub.called).to.equal(true);
    expect(startStub.firstCall.args[0]).to.equal('/tmp/project');
    expect(startStub.firstCall.args[1]).to.equal('production');
    expect(startStub.firstCall.args[2]).to.deep.equal({ concurrency: 3, verbose: undefined });
  });

  it('sets exit code when start command fails', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'project' } as any);
    sinon.stub(indexModule, 'launchFromBuild').rejects(new Error('boom'));

    stubProjectSpinners();
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    const errorStub = sinon.stub(cliUi, 'error');

    const cmd = cmdStart();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });
});
