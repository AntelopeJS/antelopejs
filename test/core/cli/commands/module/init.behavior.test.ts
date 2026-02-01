import { expect } from 'chai';
import sinon from 'sinon';
import inquirer from 'inquirer';
import { moduleInitCommand } from '../../../../../src/core/cli/commands/module/init';
import * as common from '../../../../../src/core/cli/common';
import * as gitOps from '../../../../../src/core/cli/git-operations';
import * as cliUi from '../../../../../src/core/cli/cli-ui';
import * as pkgManager from '../../../../../src/core/cli/package-manager';
import * as command from '../../../../../src/core/cli/command';
import { cleanupTempDir, makeTempDir } from '../../../../helpers/temp';

describe('module init behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('runs through module initialization flow', async () => {
    const moduleDir = makeTempDir();
    try {
      sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
      sinon.stub(common, 'displayNonDefaultGitWarning').resolves();
      sinon.stub(gitOps, 'loadManifestFromGit').resolves({
        templates: [{ name: 'basic', description: 'basic', repository: '', branch: '', interfaces: ['core'] }],
        starredInterfaces: ['core', 'extra'],
      });
      sinon.stub(gitOps, 'copyTemplate').resolves();
      sinon.stub(gitOps, 'loadInterfacesFromGit').resolves({
        core: { name: 'core', manifest: { description: 'core', versions: [], files: {}, modules: [], dependencies: {} } },
        extra: {
          name: 'extra',
          manifest: { description: 'extra', versions: [], files: {}, modules: [], dependencies: {} },
        },
      } as any);

      const importStub = sinon.stub(
        await import('../../../../../src/core/cli/commands/module/imports/add'),
        'moduleImportAddCommand',
      ).resolves();

      const promptStub = sinon.stub(inquirer, 'prompt');
      promptStub.onCall(0).resolves({ template: 'basic' });
      promptStub.onCall(1).resolves({ interfaces: ['extra'] });
      promptStub.onCall(2).resolves({ packageManager: 'npm' });
      promptStub.onCall(3).resolves({ initGit: false });

      sinon.stub(pkgManager, 'savePackageManagerToPackageJson').returns();
      sinon.stub(pkgManager, 'getInstallCommand').resolves('npm install');
      sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '', stderr: '' });

      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'update').resolves();
      sinon.stub(cliUi, 'displayBox').resolves();
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'warning');
      sinon.stub(cliUi, 'error');

      await moduleInitCommand(moduleDir, {}, false);

      expect(importStub.called).to.equal(true);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it('fails when directory is not empty', async () => {
    const moduleDir = makeTempDir();
    try {
      require('fs').writeFileSync(require('path').join(moduleDir, 'file.txt'), 'x');
      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
      sinon.stub(cliUi, 'error');
      sinon.stub(cliUi, 'warning');

      await moduleInitCommand(moduleDir, {}, false);

      expect(process.exitCode).to.equal(1);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it('handles missing template selection and git init failure', async () => {
    const moduleDir = makeTempDir();
    try {
      sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
      sinon.stub(common, 'displayNonDefaultGitWarning').resolves();
      sinon.stub(gitOps, 'loadManifestFromGit').resolves({
        templates: [{ name: 'basic', description: 'basic', repository: '', branch: '', interfaces: [] }],
        starredInterfaces: [],
      });
      sinon.stub(gitOps, 'copyTemplate').resolves();
      sinon.stub(gitOps, 'loadInterfacesFromGit').resolves({} as any);

      const promptStub = sinon.stub(inquirer, 'prompt');
      promptStub.onCall(0).resolves({ template: 'missing' });

      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
      sinon.stub(cliUi, 'error');
      sinon.stub(cliUi, 'warning');

      await moduleInitCommand(moduleDir, {}, false);

      expect(process.exitCode).to.equal(1);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it('warns when no interfaces are available for import', async () => {
    const moduleDir = makeTempDir();
    try {
      sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
      sinon.stub(common, 'displayNonDefaultGitWarning').resolves();
      sinon.stub(gitOps, 'loadManifestFromGit').resolves({
        templates: [{ name: 'basic', description: 'basic', repository: '', branch: '', interfaces: ['core'] }],
        starredInterfaces: ['core'],
      });
      sinon.stub(gitOps, 'copyTemplate').resolves();
      sinon.stub(gitOps, 'loadInterfacesFromGit').resolves({
        core: { name: 'core', manifest: { description: 'core', versions: [], files: {}, modules: [], dependencies: {} } },
      } as any);

      const importStub = sinon.stub(
        await import('../../../../../src/core/cli/commands/module/imports/add'),
        'moduleImportAddCommand',
      ).resolves();

      const promptStub = sinon.stub(inquirer, 'prompt');
      promptStub.onCall(0).resolves({ template: 'basic' });
      promptStub.onCall(1).resolves({ packageManager: 'npm' });
      promptStub.onCall(2).resolves({ initGit: false });

      sinon.stub(pkgManager, 'savePackageManagerToPackageJson').returns();
      sinon.stub(pkgManager, 'getInstallCommand').resolves('npm install');
      sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '', stderr: '' });

      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
      sinon.stub(cliUi, 'displayBox').resolves();
      const warningStub = sinon.stub(cliUi, 'warning');
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'error');

      await moduleInitCommand(moduleDir, {}, false);

      expect(importStub.called).to.equal(false);
      expect(warningStub.calledWithMatch('No interfaces available for import')).to.equal(true);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it('handles empty interface selection and git init failure', async () => {
    const moduleDir = makeTempDir();
    try {
      sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
      sinon.stub(common, 'displayNonDefaultGitWarning').resolves();
      sinon.stub(gitOps, 'loadManifestFromGit').resolves({
        templates: [{ name: 'basic', description: 'basic', repository: '', branch: '', interfaces: [] }],
        starredInterfaces: ['core'],
      });
      sinon.stub(gitOps, 'copyTemplate').resolves();
      sinon.stub(gitOps, 'loadInterfacesFromGit').resolves({
        core: { name: 'core', manifest: { description: 'core', versions: [], files: {}, modules: [], dependencies: {} } },
      } as any);

      const importStub = sinon.stub(
        await import('../../../../../src/core/cli/commands/module/imports/add'),
        'moduleImportAddCommand',
      ).resolves();

      const promptStub = sinon.stub(inquirer, 'prompt');
      promptStub.onCall(0).resolves({ template: 'basic' });
      promptStub.onCall(1).resolves({ interfaces: [] });
      promptStub.onCall(2).resolves({ packageManager: 'npm' });
      promptStub.onCall(3).resolves({ initGit: true });

      sinon.stub(pkgManager, 'savePackageManagerToPackageJson').returns();
      sinon.stub(pkgManager, 'getInstallCommand').resolves('npm install');
      sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '', stderr: '' });

      sinon.stub(require('child_process'), 'execSync').throws(new Error('git init failed'));

      const failStub = sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
      sinon.stub(cliUi, 'displayBox').resolves();
      const warningStub = sinon.stub(cliUi, 'warning');
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'error');

      await moduleInitCommand(moduleDir, {}, false);

      expect(importStub.called).to.equal(false);
      expect(failStub.called).to.equal(true);
      expect(warningStub.calledWithMatch('Could not initialize git repository')).to.equal(true);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it('rethrows errors when called from a project init flow', async () => {
    const moduleDir = makeTempDir();
    try {
      sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
      sinon.stub(common, 'displayNonDefaultGitWarning').resolves();
      sinon.stub(gitOps, 'loadManifestFromGit').rejects(new Error('boom'));

      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();

      let caught: unknown;
      try {
        await moduleInitCommand(moduleDir, {}, true);
      } catch (err) {
        caught = err;
      }

      expect(caught).to.be.instanceOf(Error);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });
});
