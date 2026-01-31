import { expect } from 'chai';
import sinon from 'sinon';
import cmdList from '../../../../../src/core/cli/commands/project/modules/list';
import cmdUpdate from '../../../../../src/core/cli/commands/project/modules/update';
import { projectModulesAddCommand, handlers } from '../../../../../src/core/cli/commands/project/modules/add';
import { projectModulesRemoveCommand } from '../../../../../src/core/cli/commands/project/modules/remove';
import * as common from '../../../../../src/core/cli/common';
import * as cliUi from '../../../../../src/core/cli/cli-ui';
import * as command from '../../../../../src/core/cli/command';
import { ConfigLoader } from '../../../../../src/core/config';
import { DownloaderRegistry } from '../../../../../src/core/downloaders/registry';
import { ModuleCache } from '../../../../../src/core/module-cache';
import { cleanupTempDir, makeTempDir, writeJson } from '../../../../helpers/temp';

describe('project modules behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('errors when project config is missing', async () => {
    sinon.stub(common, 'readConfig').resolves(undefined);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');

    await projectModulesAddCommand(['modA'], { mode: 'package', project: '/tmp/project' });

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('errors when environment is missing', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'proj', environments: {} } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');

    await projectModulesAddCommand([], { mode: 'package', project: '/tmp/project', env: 'staging' });

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('adds modules and skips existing ones', async () => {
    const config: any = { name: 'proj', modules: {} };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();

    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: { existing: { source: { type: 'package', package: 'existing', version: '1.0.0' } } },
    } as any);

    sinon.stub(ModuleCache.prototype, 'load').resolves();
    sinon.stub(DownloaderRegistry.prototype, 'getLoaderIdentifier').returns('pkg');
    sinon.stub(DownloaderRegistry.prototype, 'load').resolves([
      { manifest: { antelopeJs: { defaultConfig: { foo: 'bar' } } } } as any,
    ]);

    sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '1.0.0', stderr: '' });

    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'displayBox').resolves();

    await projectModulesAddCommand(['existing', 'newmod'], { mode: 'package', project: '/tmp/project' });

    expect(writeStub.calledOnce).to.equal(true);
    expect(config.modules).to.have.property('newmod');
  });

  it('package handler resolves latest version', async () => {
    const execStub = sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '1.2.3', stderr: '' });
    const handler = handlers.get('package')!;
    const [name, config] = await handler('pkg', { mode: 'package', project: '/tmp/project' } as any);

    expect(execStub.called).to.equal(true);
    expect(name).to.equal('pkg');
    expect((config as any).source.version).to.equal('1.2.3');
  });

  it('package handler throws when version fetch fails', async () => {
    sinon.stub(command, 'ExecuteCMD').resolves({ code: 1, stdout: '', stderr: 'oops' });
    const handler = handlers.get('package')!;
    let caught: unknown;
    try {
      await handler('pkg', { mode: 'package', project: '/tmp/project' } as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);
  });

  it('git handler validates url format', async () => {
    const handler = handlers.get('git')!;
    let caught: unknown;
    try {
      await handler('not-a-url', { mode: 'git', project: '/tmp/project' } as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);

    const [name, config] = await handler('https://example.com/repo.git', { mode: 'git', project: '/tmp/project' } as any);
    expect(name).to.equal('repo');
    expect((config as any).source.remote).to.equal('https://example.com/repo.git');
  });

  it('local and dir handlers resolve paths', async () => {
    const tempDir = makeTempDir('antelope-mod-');
    try {
      const pkgDir = `${tempDir}/moduleA`;
      writeJson(`${pkgDir}/package.json`, { name: 'moduleA' });

      const localHandler = handlers.get('local')!;
      const [localName, localConfig] = await localHandler(pkgDir, { project: tempDir } as any);
      expect(localName).to.equal('moduleA');
      expect((localConfig as any).source.type).to.equal('local');

      const dirHandler = handlers.get('dir')!;
      const [dirName, dirConfig] = await dirHandler(pkgDir, { project: tempDir } as any);
      expect(dirName.startsWith(':')).to.equal(true);
      expect((dirConfig as any).source.type).to.equal('local-folder');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it('lists modules with mixed sources', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'proj' } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {
        pkg: { source: { type: 'package', package: 'pkg', version: '1.0.0' } },
        git: { source: { type: 'git', remote: 'https://example.com/repo.git', branch: 'main' } },
        local: { source: { type: 'local', path: './local' } },
      },
    } as any);

    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(displayStub.calledOnce).to.equal(true);
  });

  it('lists no modules when empty', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'proj' } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(displayStub.calledOnce).to.equal(true);
  });

  it('removes modules with force and writes config', async () => {
    const config: any = { modules: { foo: { source: { type: 'package', package: 'foo', version: '1.0.0' } } } };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: { foo: {} } } as any);
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');

    await projectModulesRemoveCommand(['foo', 'missing'], { project: '/tmp/project', force: true });

    expect(writeStub.calledOnce).to.equal(true);
  });

  it('errors when removing missing modules without force', async () => {
    const config: any = { modules: { foo: { source: { type: 'package', package: 'foo', version: '1.0.0' } } } };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: { foo: {} } } as any);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');

    await projectModulesRemoveCommand(['missing'], { project: '/tmp/project', force: false });

    expect(errorStub.called).to.equal(true);
    expect(writeStub.called).to.equal(false);
  });

  it('updates npm modules and writes config', async () => {
    const config: any = { modules: { pkg: { source: { type: 'package', package: 'pkg', version: '1.0.0' } } } };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {
        pkg: { source: { type: 'package', package: 'pkg', version: '1.0.0' } },
      },
    } as any);

    sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '2.0.0', stderr: '' });
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(writeStub.calledOnce).to.equal(true);
  });

  it('handles missing, non-package, and dry-run updates', async () => {
    const config: any = {
      modules: {
        pkg1: { source: { type: 'package', package: 'pkg1', version: '1.0.0' } },
        pkgSame: { source: { type: 'package', package: 'pkgSame', version: '1.0.0' } },
        gitMod: { source: { type: 'git', remote: 'https://example.com/repo.git' } },
      },
    };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(common, 'writeConfig').resolves();
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {
        pkg1: { source: { type: 'package', package: 'pkg1', version: '1.0.0' } },
        pkgSame: { source: { type: 'package', package: 'pkgSame', version: '1.0.0' } },
        gitMod: { source: { type: 'git', remote: 'https://example.com/repo.git' } },
      },
    } as any);

    const execStub = sinon.stub(command, 'ExecuteCMD');
    execStub.onFirstCall().resolves({ code: 0, stdout: '2.0.0', stderr: '' });
    execStub.onSecondCall().resolves({ code: 0, stdout: '1.0.0', stderr: '' });

    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--dry-run', 'pkg1', 'pkgSame', 'gitMod', 'missing']);
  });
});
