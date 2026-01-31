import { expect } from 'chai';
import sinon from 'sinon';
import inquirer from 'inquirer';
import cmdInstall from '../../../../../../src/core/cli/commands/project/modules/install';
import * as common from '../../../../../../src/core/cli/common';
import * as cliUi from '../../../../../../src/core/cli/cli-ui';
import * as gitOps from '../../../../../../src/core/cli/git-operations';
import { ConfigLoader } from '../../../../../../src/core/config';
import { DownloaderRegistry } from '../../../../../../src/core/downloaders/registry';
import { ModuleCache } from '../../../../../../src/core/module-cache';
import { ModuleManifest } from '../../../../../../src/core/module-manifest';
import { terminalDisplay } from '../../../../../../src/core/cli/terminal-display';

describe('project modules install behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('analyzes dependencies and installs selected modules', async () => {
    const baseConfig: any = {
      name: 'proj',
      modules: {
        app: { source: { type: 'package', package: 'app', version: '1.0.0' } },
      },
    };

    sinon.stub(common, 'readConfig').resolves(baseConfig);
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, 'displayNonDefaultGitWarning').resolves();

    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {
        app: { source: { type: 'package', package: 'app', version: '1.0.0' } },
      },
    } as any);

    sinon.stub(ModuleCache.prototype, 'load').resolves();

    const fakeManifest = {
      imports: ['iface@1.0.0'],
      exports: {},
      loadExports: sinon.stub().resolves(),
    };
    sinon.stub(DownloaderRegistry.prototype, 'load').resolves([fakeManifest as any]);
    sinon.stub(DownloaderRegistry.prototype, 'getLoaderIdentifier').returns('pkg:module');

    sinon.stub(ModuleManifest, 'create').rejects(new Error('skip core'));

    sinon.stub(gitOps, 'loadInterfaceFromGit').resolves({
      name: 'iface',
      manifest: {
        description: 'iface',
        versions: ['1.0.0'],
        files: {},
        dependencies: {},
        modules: [{ name: 'modA', source: { type: 'package', package: 'modA', version: '1.0.0' } }],
      },
    } as any);

    const addStub = sinon.stub(
      await import('../../../../../../src/core/cli/commands/project/modules/add'),
      'projectModulesAddCommand',
    ).resolves();

    const promptStub = sinon.stub(inquirer, 'prompt');
    promptStub.onCall(0).resolves({ moduleName: 'modA' });

    sinon.stub(terminalDisplay, 'startSpinner').resolves();
    sinon.stub(terminalDisplay, 'stopSpinner').resolves();
    sinon.stub(terminalDisplay, 'failSpinner').resolves();

    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');

    const cmd = cmdInstall();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(addStub.called).to.equal(true);
  });

  it('completes when no unresolved imports are found', async () => {
    const baseConfig: any = {
      name: 'proj',
      modules: {
        app: { source: { type: 'package', package: 'app', version: '1.0.0' } },
      },
    };

    sinon.stub(common, 'readConfig').resolves(baseConfig);
    sinon.stub(common, 'readUserConfig').resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, 'displayNonDefaultGitWarning').resolves();

    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {
        app: { source: { type: 'package', package: 'app', version: '1.0.0' } },
      },
    } as any);

    sinon.stub(ModuleCache.prototype, 'load').resolves();

    const fakeManifest = {
      imports: [],
      exports: {},
      loadExports: sinon.stub().resolves(),
    };
    sinon.stub(DownloaderRegistry.prototype, 'load').resolves([fakeManifest as any]);
    sinon.stub(DownloaderRegistry.prototype, 'getLoaderIdentifier').returns('pkg:module');

    sinon.stub(ModuleManifest, 'create').rejects(new Error('skip core'));

    const loadStub = sinon.stub(gitOps, 'loadInterfaceFromGit').resolves(undefined as any);
    const promptStub = sinon.stub(inquirer, 'prompt');

    sinon.stub(terminalDisplay, 'startSpinner').resolves();
    sinon.stub(terminalDisplay, 'stopSpinner').resolves();
    sinon.stub(terminalDisplay, 'failSpinner').resolves();

    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');

    const cmd = cmdInstall();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(loadStub.called).to.equal(false);
    expect(promptStub.called).to.equal(false);
  });
});
