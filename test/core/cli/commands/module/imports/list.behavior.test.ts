import { expect } from 'chai';
import sinon from 'sinon';
import cmdList from '../../../../../../src/core/cli/commands/module/imports/list';
import * as common from '../../../../../../src/core/cli/common';
import * as cliUi from '../../../../../../src/core/cli/cli-ui';

describe('module imports list behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('fails when module manifest is missing', async () => {
    sinon.stub(common, 'readModuleManifest').resolves(undefined);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module']);

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('fails when AntelopeJS config is missing', async () => {
    sinon.stub(common, 'readModuleManifest').resolves({ name: 'test-module' } as any);
    const warningStub = sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module']);

    expect(warningStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('renders imports with overrides in verbose mode', async () => {
    sinon.stub(common, 'readModuleManifest').resolves({
      name: 'test-module',
      version: '1.0.0',
      antelopeJs: {
        imports: [{ name: 'foo@1.0.0', git: 'https://example.com' }],
        importsOptional: ['bar@2.0.0'],
      },
    } as any);

    sinon.stub(common, 'readConfig').resolves({
      modules: {
        'test-module': {
          importOverrides: [{ interface: 'foo', source: 'local' }],
        },
      },
    } as any);

    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module', '--verbose']);

    expect(displayStub.calledOnce).to.equal(true);
  });

  it('renders help text when imports exist and not verbose', async () => {
    sinon.stub(common, 'readModuleManifest').resolves({
      name: 'test-module',
      version: '1.0.0',
      antelopeJs: {
        imports: ['foo@1.0.0', { name: 'bar@2.0.0', skipInstall: true }],
        importsOptional: [{ name: 'baz@3.0.0', git: 'https://example.com' }],
      },
    } as any);

    sinon.stub(common, 'readConfig').resolves({
      modules: {
        'test-module': 'package',
      },
    } as any);

    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    const logStub = sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module']);

    expect(displayStub.calledOnce).to.equal(true);
    expect(logStub.called).to.equal(true);
  });

  it('renders empty sections when no imports exist', async () => {
    sinon.stub(common, 'readModuleManifest').resolves({
      name: 'test-module',
      version: '1.0.0',
      antelopeJs: {
        imports: [],
        importsOptional: [],
      },
    } as any);

    sinon.stub(common, 'readConfig').resolves({ modules: {} } as any);

    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module', '--verbose']);

    expect(displayStub.calledOnce).to.equal(true);
  });
});
