import { expect } from 'chai';
import sinon from 'sinon';
import { moduleImportAddCommand } from '../../../../../../src/core/cli/commands/module/imports/add';
import * as common from '../../../../../../src/core/cli/common';
import * as gitOps from '../../../../../../src/core/cli/git-operations';
import * as cliUi from '../../../../../../src/core/cli/cli-ui';

describe('module imports add behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('fails when module manifest is missing', async () => {
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, 'displayNonDefaultGitWarning').resolves();
    sinon.stub(common, 'readModuleManifest').resolves(undefined);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    await moduleImportAddCommand(['foo@1.0.0'], {
      module: '/tmp/module',
      optional: false,
      skipInstall: true,
    });

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('adds interfaces and dependencies and installs', async () => {
    const manifest: any = { name: 'test-module', version: '1.0.0', antelopeJs: { imports: [], importsOptional: [] } };
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, 'displayNonDefaultGitWarning').resolves();
    const readStub = sinon.stub(common, 'readModuleManifest');
    readStub.onFirstCall().resolves({ ...manifest });
    readStub.onSecondCall().resolves({ ...manifest });
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();

    const fooInfo = {
      name: 'foo',
      manifest: {
        description: 'foo',
        versions: ['1.0.0', '2.0.0'],
        files: {},
        modules: [],
        dependencies: {
          '2.0.0': { interfaces: ['dep@1.0.0'], packages: [] },
          '1.0.0': { interfaces: [], packages: [] },
        },
      },
    };
    const depInfo = {
      name: 'dep',
      manifest: {
        description: 'dep',
        versions: ['1.0.0'],
        files: {},
        modules: [],
        dependencies: {
          '1.0.0': { interfaces: [], packages: [] },
        },
      },
    };

    sinon
      .stub(gitOps, 'loadInterfaceFromGit')
      .callsFake(async (_git, name) => (name === 'foo' ? (fooInfo as any) : name === 'dep' ? (depInfo as any) : undefined));
    const installStub = sinon.stub(gitOps, 'installInterfaces').resolves();

    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi.ProgressBar.prototype, 'start').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'update').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'stop').returns();

    await moduleImportAddCommand(['foo'], {
      module: '/tmp/module',
      optional: false,
      skipInstall: false,
    });

    expect(installStub.calledOnce).to.equal(true);
    expect(writeStub.calledOnce).to.equal(true);
    const writtenManifest = writeStub.firstCall.args[1] as any;
    const imports = writtenManifest.antelopeJs.imports as any[];
    expect(imports.some((item) => item === 'foo@2.0.0')).to.equal(true);
    expect(imports.some((item) => item === 'dep@1.0.0')).to.equal(true);
  });

  it('skips existing imports and handles invalid interface format', async () => {
    const manifest: any = {
      name: 'test-module',
      version: '1.0.0',
      antelopeJs: { imports: ['foo@1.0.0'], importsOptional: [] },
    };
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, 'displayNonDefaultGitWarning').resolves();
    sinon.stub(common, 'readModuleManifest').resolves({ ...manifest });
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();

    sinon.stub(gitOps, 'loadInterfaceFromGit').resolves({
      name: 'foo',
      manifest: {
        description: 'foo',
        versions: ['1.0.0'],
        files: {},
        modules: [],
        dependencies: { '1.0.0': { interfaces: [], packages: [] } },
      },
    } as any);

    const installStub = sinon.stub(gitOps, 'installInterfaces').resolves();
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi.ProgressBar.prototype, 'start').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'update').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'stop').returns();

    await moduleImportAddCommand(['foo@1.0.0', '@1.0.0'], {
      module: '/tmp/module',
      optional: true,
      skipInstall: true,
    });

    expect(installStub.called).to.equal(false);
    expect(writeStub.calledOnce).to.equal(true);
  });

  it('skips install and reports version mismatches', async () => {
    const manifest: any = { name: 'test-module', version: '1.0.0', antelopeJs: { imports: [], importsOptional: [] } };
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, 'displayNonDefaultGitWarning').resolves();
    const readStub = sinon.stub(common, 'readModuleManifest');
    readStub.onFirstCall().resolves({ ...manifest });
    readStub.onSecondCall().resolves({ ...manifest });
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();

    const fooInfo = {
      name: 'foo',
      manifest: {
        description: 'foo',
        versions: ['1.0.0'],
        files: {},
        modules: [],
        dependencies: { '1.0.0': { interfaces: [], packages: [] } },
      },
    };
    const barInfo = {
      name: 'bar',
      manifest: {
        description: 'bar',
        versions: ['1.0.0'],
        files: {},
        modules: [],
        dependencies: { '1.0.0': { interfaces: [], packages: [] } },
      },
    };

    sinon
      .stub(gitOps, 'loadInterfaceFromGit')
      .callsFake(async (_git, name) => (name === 'foo' ? (fooInfo as any) : name === 'bar' ? (barInfo as any) : undefined));
    const installStub = sinon.stub(gitOps, 'installInterfaces').resolves();

    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi.ProgressBar.prototype, 'start').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'update').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'stop').returns();

    await moduleImportAddCommand(['foo', 'bar@2.0.0'], {
      module: '/tmp/module',
      optional: false,
      skipInstall: true,
    });

    expect(installStub.called).to.equal(false);
    expect(errorStub.called).to.equal(true);
    expect(writeStub.calledOnce).to.equal(true);
  });

  it('adds git imports and skips missing interfaces', async () => {
    const manifest: any = { name: 'test-module', version: '1.0.0', antelopeJs: { imports: [], importsOptional: [] } };
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, 'displayNonDefaultGitWarning').resolves();
    const readStub = sinon.stub(common, 'readModuleManifest');
    readStub.onFirstCall().resolves({ ...manifest });
    readStub.onSecondCall().resolves({ ...manifest });
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();

    const fooInfo = {
      name: 'foo',
      manifest: {
        description: 'foo',
        versions: ['1.0.0'],
        files: {},
        modules: [],
        dependencies: { '1.0.0': { interfaces: [], packages: [] } },
      },
    };

    sinon.stub(gitOps, 'loadInterfaceFromGit').callsFake(async (_git, name) => (name === 'foo' ? (fooInfo as any) : undefined));
    const installStub = sinon.stub(gitOps, 'installInterfaces').resolves();

    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi.ProgressBar.prototype, 'start').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'update').returnsThis();
    sinon.stub(cliUi.ProgressBar.prototype, 'stop').returns();

    await moduleImportAddCommand(['foo@1.0.0', 'missing@1.0.0'], {
      module: '/tmp/module',
      optional: false,
      skipInstall: true,
      git: 'https://example.com/repo.git',
    });

    expect(installStub.called).to.equal(false);
    expect(writeStub.calledOnce).to.equal(true);
    const writtenManifest = writeStub.firstCall.args[1] as any;
    const imports = writtenManifest.antelopeJs.imports as any[];
    expect(imports[0]).to.have.property('git');
  });
});
