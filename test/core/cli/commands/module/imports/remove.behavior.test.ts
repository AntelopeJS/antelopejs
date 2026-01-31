import { expect } from 'chai';
import sinon from 'sinon';
import cmdRemove from '../../../../../../src/core/cli/commands/module/imports/remove';
import * as common from '../../../../../../src/core/cli/common';
import * as gitOps from '../../../../../../src/core/cli/git-operations';
import * as cliUi from '../../../../../../src/core/cli/cli-ui';

describe('module imports remove behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('fails when module manifest is missing', async () => {
    sinon.stub(common, 'readModuleManifest').resolves(undefined);
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    const cmd = cmdRemove();
    await cmd.parseAsync(['node', 'test', 'foo@1.0.0', '--module', '/tmp/module']);

    expect(process.exitCode).to.equal(1);
  });

  it('fails on malformed interface name', async () => {
    sinon.stub(common, 'readModuleManifest').resolves({ name: 'test-module', antelopeJs: {} } as any);
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    const cmd = cmdRemove();
    await cmd.parseAsync(['node', 'test', 'foo', '--module', '/tmp/module']);

    expect(process.exitCode).to.equal(1);
  });

  it('errors when none of the interfaces are imported', async () => {
    sinon.stub(common, 'readModuleManifest').resolves({ name: 'test-module' } as any);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    const cmd = cmdRemove();
    await cmd.parseAsync(['node', 'test', 'foo@1.0.0', '--module', '/tmp/module']);

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('warns about missing interfaces but removes existing ones', async () => {
    const manifest: any = {
      name: 'test-module',
      antelopeJs: { imports: ['foo@1.0.0'], importsOptional: [] },
    };
    sinon.stub(common, 'readModuleManifest').resolves(manifest);
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();
    const removeStub = sinon.stub(gitOps, 'removeInterface').resolves();
    const warningStub = sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');

    const cmd = cmdRemove();
    await cmd.parseAsync(['node', 'test', 'foo@1.0.0', 'missing@1.0.0', '--module', '/tmp/module']);

    expect(removeStub.calledOnce).to.equal(true);
    expect(writeStub.calledOnce).to.equal(true);
    expect(warningStub.called).to.equal(true);
  });

  it('removes interfaces and writes manifest', async () => {
    const manifest: any = {
      name: 'test-module',
      antelopeJs: { imports: ['foo@1.0.0'], importsOptional: [] },
    };
    sinon.stub(common, 'readModuleManifest').resolves(manifest);
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();
    const removeStub = sinon.stub(gitOps, 'removeInterface').resolves();
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');

    const cmd = cmdRemove();
    await cmd.parseAsync(['node', 'test', 'foo@1.0.0', '--module', '/tmp/module']);

    expect(removeStub.calledOnce).to.equal(true);
    expect(writeStub.calledOnce).to.equal(true);
  });

  it('removes optional imports', async () => {
    const manifest: any = {
      name: 'test-module',
      antelopeJs: { imports: [], importsOptional: ['opt@1.0.0'] },
    };
    sinon.stub(common, 'readModuleManifest').resolves(manifest);
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();
    const removeStub = sinon.stub(gitOps, 'removeInterface').resolves();
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');

    const cmd = cmdRemove();
    await cmd.parseAsync(['node', 'test', 'opt@1.0.0', '--module', '/tmp/module']);

    expect(removeStub.calledOnce).to.equal(true);
    expect(writeStub.calledOnce).to.equal(true);
    expect(manifest.antelopeJs.importsOptional).to.deep.equal([]);
  });

  it('handles remove errors', async () => {
    const manifest: any = {
      name: 'test-module',
      antelopeJs: { imports: [], importsOptional: ['opt@1.0.0'] },
    };
    sinon.stub(common, 'readModuleManifest').resolves(manifest);
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();
    const removeStub = sinon.stub(gitOps, 'removeInterface').throws(new Error('fail'));
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');

    const cmd = cmdRemove();
    await cmd.parseAsync(['node', 'test', 'opt@1.0.0', '--module', '/tmp/module']);

    expect(removeStub.calledOnce).to.equal(true);
    expect(errorStub.called).to.equal(true);
    expect(writeStub.called).to.equal(false);
  });
});
