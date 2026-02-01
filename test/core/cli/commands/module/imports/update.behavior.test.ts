import { expect } from 'chai';
import sinon from 'sinon';
import cmdUpdate from '../../../../../../src/core/cli/commands/module/imports/update';
import * as common from '../../../../../../src/core/cli/common';
import * as gitOps from '../../../../../../src/core/cli/git-operations';
import * as cliUi from '../../../../../../src/core/cli/cli-ui';

describe('module imports update behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('fails when manifest is missing', async () => {
    sinon.stub(common, 'readModuleManifest').resolves(undefined);
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module']);

    expect(process.exitCode).to.equal(1);
  });

  it('initializes antelopeJs and reports when no imports exist', async () => {
    const manifest: any = { name: 'mod' };
    sinon.stub(common, 'readModuleManifest').resolves(manifest);
    const errorStub = sinon.stub(cliUi, 'error');
    const infoStub = sinon.stub(cliUi, 'info');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module']);

    expect(errorStub.called).to.equal(true);
    expect(infoStub.called).to.equal(true);
  });

  it('dry run does not install or write', async () => {
    const manifest: any = { antelopeJs: { imports: ['foo@1.0.0'], importsOptional: [] } };
    sinon.stub(common, 'readModuleManifest').resolves(manifest);
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });

    sinon.stub(gitOps, 'loadInterfacesFromGit').resolves({
      foo: {
        name: 'foo',
        manifest: { versions: ['1.0.0'], dependencies: {}, files: {}, modules: [] },
      } as any,
    });

    const removeStub = sinon.stub(gitOps, 'removeInterface').resolves();
    const installStub = sinon.stub(gitOps, 'installInterfaces').resolves();
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();
    const symlinkStub = sinon.stub(gitOps, 'createAjsSymlinks').resolves();

    sinon.stub(cliUi.ProgressBar.prototype, 'start').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'update').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'stop').returns();
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module', '--dry-run']);

    expect(removeStub.called).to.equal(false);
    expect(installStub.called).to.equal(false);
    expect(writeStub.called).to.equal(false);
    expect(symlinkStub.called).to.equal(false);
  });

  it('updates and installs when not dry run', async () => {
    const manifest: any = { antelopeJs: { imports: ['foo@1.0.0'], importsOptional: [] } };
    sinon.stub(common, 'readModuleManifest').resolves(manifest);
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });

    sinon.stub(gitOps, 'loadInterfacesFromGit').resolves({
      foo: {
        name: 'foo',
        manifest: { versions: ['1.0.0'], dependencies: {}, files: {}, modules: [] },
      } as any,
    });

    const removeStub = sinon.stub(gitOps, 'removeInterface').resolves();
    const installStub = sinon.stub(gitOps, 'installInterfaces').resolves();
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();
    const symlinkStub = sinon.stub(gitOps, 'createAjsSymlinks').resolves();

    sinon.stub(cliUi.ProgressBar.prototype, 'start').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'update').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'stop').returns();
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module']);

    expect(removeStub.called).to.equal(true);
    expect(installStub.called).to.equal(true);
    expect(writeStub.called).to.equal(true);
    expect(symlinkStub.called).to.equal(true);
  });

  it('handles missing selected interfaces', async () => {
    const manifest: any = { antelopeJs: { imports: ['foo@1.0.0'], importsOptional: [] } };
    sinon.stub(common, 'readModuleManifest').resolves(manifest);
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', 'missing', '--module', '/tmp/module']);

    expect(errorStub.called).to.equal(true);
  });

  it('fails on malformed interface entries', async () => {
    const manifest: any = { antelopeJs: { imports: ['foo'], importsOptional: [] } };
    sinon.stub(common, 'readModuleManifest').resolves(manifest);
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module']);

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('reports missing interfaces and version mismatches', async () => {
    const manifest: any = {
      antelopeJs: { imports: ['missing@1.0.0', 'foo@2.0.0'], importsOptional: [] },
    };
    sinon.stub(common, 'readModuleManifest').resolves(manifest);
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });

    sinon.stub(gitOps, 'loadInterfacesFromGit').resolves({
      foo: {
        name: 'foo',
        manifest: { versions: ['1.0.0'], dependencies: {}, files: {}, modules: [] },
      } as any,
    });

    const removeStub = sinon.stub(gitOps, 'removeInterface').resolves();
    const installStub = sinon.stub(gitOps, 'installInterfaces').resolves();
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();
    const symlinkStub = sinon.stub(gitOps, 'createAjsSymlinks').resolves();

    sinon.stub(cliUi.ProgressBar.prototype, 'start').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'update').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'stop').returns();
    const warningStub = sinon.stub(cliUi, 'warning');
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module']);

    expect(removeStub.called).to.equal(false);
    expect(installStub.called).to.equal(false);
    expect(writeStub.called).to.equal(false);
    expect(symlinkStub.called).to.equal(true);
    expect(warningStub.callCount).to.be.greaterThan(0);
    expect(errorStub.called).to.equal(true);
  });
});
