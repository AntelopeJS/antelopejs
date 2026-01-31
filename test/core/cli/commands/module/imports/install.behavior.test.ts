import { expect } from 'chai';
import sinon from 'sinon';
import cmdInstall from '../../../../../../src/core/cli/commands/module/imports/install';
import * as common from '../../../../../../src/core/cli/common';
import * as gitOps from '../../../../../../src/core/cli/git-operations';
import * as cliUi from '../../../../../../src/core/cli/cli-ui';
import { cleanupTempDir, makeTempDir } from '../../../../../helpers/temp';
import path from 'path';
import { mkdirSync, writeFileSync } from 'fs';

describe('module imports install behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('fails when module manifest is missing', async () => {
    sinon.stub(common, 'readModuleManifest').resolves(undefined);
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    const cmd = cmdInstall();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module']);

    expect(process.exitCode).to.equal(1);
  });

  it('fails when AntelopeJS config is missing', async () => {
    sinon.stub(common, 'readModuleManifest').resolves({ name: 'test-module' } as any);
    const warningStub = sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'error');

    const cmd = cmdInstall();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module']);

    expect(warningStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('skips when all interfaces are already installed', async () => {
    const tempDir = makeTempDir();
    try {
      const interfacesDir = path.join(tempDir, '.antelope', 'interfaces.d', 'foo');
      mkdirSync(interfacesDir, { recursive: true });
      writeFileSync(path.join(interfacesDir, '1.0.0.d.ts'), '// interface');

      sinon.stub(common, 'readModuleManifest').resolves({
        name: 'test-module',
        antelopeJs: { imports: ['foo@1.0.0'], importsOptional: [] },
      } as any);

      const loadStub = sinon.stub(gitOps, 'loadInterfacesFromGit').resolves({});
      sinon.stub(cliUi, 'success');
      sinon.stub(cliUi, 'info');

      const cmd = cmdInstall();
      await cmd.parseAsync(['node', 'test', '--module', tempDir]);

      expect(loadStub.called).to.equal(false);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it('honors skip-install and creates symlinks', async () => {
    const tempDir = makeTempDir();
    try {
      sinon.stub(common, 'readModuleManifest').resolves({
        name: 'test-module',
        antelopeJs: { imports: [{ name: 'foo@1.0.0', skipInstall: true }], importsOptional: [] },
      } as any);
      sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });

      sinon.stub(gitOps, 'loadInterfacesFromGit').resolves({
        foo: {
          name: 'foo',
          manifest: { versions: ['1.0.0'], dependencies: {}, files: {}, modules: [] },
        } as any,
      });

      const installStub = sinon.stub(gitOps, 'installInterfaces').resolves();
      const symlinkStub = sinon.stub(gitOps, 'createAjsSymlinks').resolves();
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'success');
      sinon.stub(cliUi, 'warning');

      const cmd = cmdInstall();
      await cmd.parseAsync(['node', 'test', '--module', tempDir]);

      expect(installStub.called).to.equal(false);
      expect(symlinkStub.called).to.equal(true);
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});
