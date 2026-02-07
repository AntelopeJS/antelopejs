import { expect } from 'chai';
import sinon from 'sinon';
import cmdList from '../../../../../../src/core/cli/commands/project/modules/list';
import * as common from '../../../../../../src/core/cli/common';
import * as cliUi from '../../../../../../src/core/cli/cli-ui';
import { ConfigLoader } from '../../../../../../src/core/config';

describe('project modules list behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('fails when project config is missing', async () => {
    sinon.stub(common, 'readConfig').resolves(undefined);
    const errorStub = sinon.stub(cliUi, 'error');
    const warningStub = sinon.stub(cliUi, 'warning');
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(errorStub.calledOnce).to.equal(true);
    expect(warningStub.calledOnce).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('renders empty state when no modules are configured', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    const loadStub = sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(loadStub.calledOnce).to.equal(true);
    expect(loadStub.firstCall.args[1]).to.equal('default');
    expect(displayStub.calledOnce).to.equal(true);
    expect(String(displayStub.firstCall.args[0])).to.include('No modules installed in this project.');
    expect(displayStub.firstCall.args[2]).to.deep.equal({
      padding: 1,
      borderColor: 'yellow',
    });
  });

  it('renders module details for known and unknown source formats', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {
        packageModule: { source: { type: 'package', package: '@scope/pkg', version: '1.2.3' } },
        gitModule: {
          source: { type: 'git', remote: 'https://github.com/org/repo.git', branch: 'main', commit: 'abcdef12' },
        },
        localModule: { source: { type: 'local', path: '/tmp/local' } },
        localFolderModule: { source: { type: 'local-folder', path: '/tmp/local-folder' } },
        unknownObjectModule: { source: { path: '/tmp/no-type' } },
        unknownStringModule: { source: 'bad-source' },
      },
    } as any);
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    const infoStub = sinon.stub(cliUi, 'info');
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--env', 'staging']);

    expect(displayStub.calledOnce).to.equal(true);
    expect(String(displayStub.firstCall.args[1])).to.include('staging');
    expect(displayStub.firstCall.args[2]).to.deep.equal({
      padding: 1,
      borderColor: 'green',
    });

    const content = String(displayStub.firstCall.args[0]);
    expect(content).to.include('npm package');
    expect(content).to.include('git repository');
    expect(content).to.include('Branch');
    expect(content).to.include('Commit');
    expect(content).to.include('local directory');
    expect(content).to.include('unknown');
    expect(infoStub.calledOnce).to.equal(true);
    expect(String(infoStub.firstCall.args[0])).to.include('6');
    expect(String(infoStub.firstCall.args[0])).to.include('modules');
  });

  it('uses singular label when exactly one module is installed', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {
        onlyModule: { source: { type: 'package', package: '@scope/one', version: '2.0.0' } },
      },
    } as any);
    sinon.stub(cliUi, 'displayBox').resolves();
    const infoStub = sinon.stub(cliUi, 'info');
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(infoStub.calledOnce).to.equal(true);
    expect(String(infoStub.firstCall.args[0])).to.include('1');
    expect(String(infoStub.firstCall.args[0])).to.include('module installed.');
  });
});
