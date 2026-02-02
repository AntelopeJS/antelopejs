import { expect } from 'chai';
import sinon from 'sinon';
import cmdList from '../../../../../src/core/cli/commands/project/modules/list';
import cmdUpdate from '../../../../../src/core/cli/commands/project/modules/update';
import { projectModulesAddCommand, handlers } from '../../../../../src/core/cli/commands/project/modules/add';
import { projectModulesRemoveCommand } from '../../../../../src/core/cli/commands/project/modules/remove';
import * as common from '../../../../../src/core/cli/common';
import * as cliUi from '../../../../../src/core/cli/cli-ui';
import * as command from '../../../../../src/core/cli/command';
import { stripAnsi } from '../../../../../src/core/cli/logging-utils';
import { ConfigLoader } from '../../../../../src/core/config';
import { DownloaderRegistry } from '../../../../../src/core/downloaders/registry';
import * as packageDownloader from '../../../../../src/core/downloaders/package';
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
    sinon
      .stub(DownloaderRegistry.prototype, 'load')
      .resolves([{ manifest: { antelopeJs: { defaultConfig: { foo: 'bar' } } } } as any]);

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

  it('uses absolute module path for local mode in logs', async () => {
    const config: any = { name: 'proj', modules: {} };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();
    sinon.stub(common, 'writeConfig').resolves();

    const infoStub = sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'displayBox').resolves();

    const originalHandler = handlers.get('local');
    handlers.set('local', async () => ['absMod', 'local-src'] as any);
    const absPath = '/tmp/abs-module';

    try {
      await projectModulesAddCommand([absPath], { mode: 'local', project: '/tmp/project' });
    } finally {
      if (originalHandler) {
        handlers.set('local', originalHandler);
      }
    }

    const infoCalls = infoStub.getCalls().map((call) => call.args[0] as string);
    expect(infoCalls.some((msg) => msg.includes(absPath))).to.equal(true);
  });

  it('uses absolute cache folder when configured', async () => {
    const config: any = { name: 'proj', modules: {}, cacheFolder: '/tmp/abs-cache' };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    const loadStub = sinon.stub(ModuleCache.prototype, 'load').callsFake(function (this: ModuleCache) {
      expect(this.path).to.equal('/tmp/abs-cache');
      return Promise.resolve();
    });
    sinon.stub(common, 'writeConfig').resolves();

    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'displayBox').resolves();

    await projectModulesAddCommand([], { mode: 'package', project: '/tmp/project' });
    expect(loadStub.calledOnce).to.equal(true);
  });

  it('skips modules and shows yellow summary when all skipped', async () => {
    const config: any = { name: 'proj', modules: {} };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: { existing: {} } } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();
    sinon.stub(common, 'writeConfig').resolves();

    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');

    await projectModulesAddCommand(['existing@1.0.0'], { mode: 'package', project: '/tmp/project' });

    const options = displayStub.firstCall.args[2] as any;
    expect(options.borderColor).to.equal('yellow');
  });

  it('ignores falsy sources returned by handler', async () => {
    const config: any = { name: 'proj', modules: {} };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();
    sinon.stub(common, 'writeConfig').resolves();

    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');

    const originalHandler = handlers.get('local');
    handlers.set('local', async () => undefined as any);
    try {
      await projectModulesAddCommand(['modA'], { mode: 'local', project: '/tmp/project' });
    } finally {
      if (originalHandler) {
        handlers.set('local', originalHandler);
      }
    }

    expect(displayStub.called).to.equal(false);
    expect(Object.keys(config.modules)).to.have.length(0);
  });

  it('logs download success when registry returns no manifests', async () => {
    const config: any = { name: 'proj', modules: {} };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();
    sinon.stub(DownloaderRegistry.prototype, 'getLoaderIdentifier').returns('pkg');
    sinon.stub(DownloaderRegistry.prototype, 'load').resolves([]);
    sinon.stub(common, 'writeConfig').resolves();

    const successStub = sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'displayBox').resolves();

    await projectModulesAddCommand(['pkg@1.0.0'], { mode: 'package', project: '/tmp/project' });
    expect(successStub.called).to.equal(true);
  });

  it('warns when download fails with non-error', async () => {
    const config: any = { name: 'proj', modules: {} };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();
    sinon.stub(DownloaderRegistry.prototype, 'getLoaderIdentifier').returns('pkg');
    sinon.stub(DownloaderRegistry.prototype, 'load').callsFake(() => Promise.reject('boom'));
    sinon.stub(common, 'writeConfig').resolves();

    const warnStub = sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'displayBox').resolves();

    await projectModulesAddCommand(['pkg@1.0.0'], { mode: 'package', project: '/tmp/project' });
    expect(warnStub.called).to.equal(true);
    const warningMsg = warnStub.firstCall.args[0] as string;
    expect(warningMsg).to.include('boom');
  });

  it('reports handler rejection with non-error', async () => {
    const config: any = { name: 'proj' };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(common, 'writeConfig').resolves();
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();

    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'displayBox').resolves();

    const originalHandler = handlers.get('local');
    handlers.set('local', () => Promise.reject('boom') as any);
    try {
      await projectModulesAddCommand(['modA'], { mode: 'local', project: '/tmp/project' });
    } finally {
      if (originalHandler) {
        handlers.set('local', originalHandler);
      }
    }

    expect(errorStub.called).to.equal(true);
    const errorMsg = errorStub.firstCall.args[0] as string;
    expect(errorMsg).to.include('boom');
  });

  it('warns when download fails after loader identifier resolves', async () => {
    const config: any = { name: 'proj', modules: {} };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(common, 'writeConfig').resolves();
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();
    sinon.stub(packageDownloader, 'registerPackageDownloader').callsFake((registry) => {
      (registry as any).register('package', 'package', async () => {
        throw new Error('down');
      });
    });

    const warnStub = sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'displayBox').resolves();

    const originalHandler = handlers.get('local');
    handlers.set(
      'local',
      async () => ['localmod', { source: { type: 'package', package: 'localmod', version: '1.0.0' } }] as any,
    );
    try {
      await projectModulesAddCommand(['localmod'], { mode: 'local', project: '/tmp/project' });
    } finally {
      if (originalHandler) {
        handlers.set('local', originalHandler);
      }
    }

    expect(warnStub.called).to.equal(true);
  });

  it('handles handler errors and initializes env modules', async () => {
    const config: any = { name: 'proj' };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();

    const infoStub = sinon.stub(cliUi, 'info');
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'displayBox').resolves();

    const originalHandler = handlers.get('local');
    handlers.set('local', async () => {
      throw new Error('boom');
    });

    try {
      await projectModulesAddCommand(['modules/modA'], { mode: 'local', project: '/tmp/project' });
    } finally {
      if (originalHandler) {
        handlers.set('local', originalHandler);
      }
    }

    expect(errorStub.called).to.equal(true);
    expect(config.modules).to.be.an('object');
    expect(writeStub.calledOnce).to.equal(true);

    const expectedPath = '/tmp/project/modules/modA';
    const infoCalls = infoStub.getCalls().map((call) => call.args[0] as string);
    expect(infoCalls.some((msg) => msg.includes(expectedPath))).to.equal(true);
  });

  it('warns when download to cache fails but still adds module', async () => {
    const config: any = { name: 'proj', modules: {} };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();

    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();

    sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '1.0.0', stderr: '' });
    sinon.stub(DownloaderRegistry.prototype, 'getLoaderIdentifier').returns('pkg');
    sinon.stub(DownloaderRegistry.prototype, 'load').rejects(new Error('download failed'));

    const warnStub = sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'displayBox').resolves();

    await projectModulesAddCommand(['pkg'], { mode: 'package', project: '/tmp/project' });

    expect(warnStub.called).to.equal(true);
    expect(writeStub.calledOnce).to.equal(true);
    expect(config.modules).to.have.property('pkg');
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

    const [name, config] = await handler('https://example.com/repo.git', {
      mode: 'git',
      project: '/tmp/project',
    } as any);
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

  it('local and dir handlers resolve relative paths and root', async () => {
    const tempDir = makeTempDir('antelope-mod-rel-');
    try {
      const pkgDir = `${tempDir}/moduleA`;
      writeJson(`${pkgDir}/package.json`, { name: 'moduleA' });
      writeJson(`${tempDir}/package.json`, { name: 'root-module' });

      const localHandler = handlers.get('local')!;
      const [localName, localConfig] = await localHandler('moduleA', { project: tempDir } as any);
      expect(localName).to.equal('moduleA');
      expect((localConfig as any).source.path).to.equal('moduleA');

      const [rootName, rootConfig] = await localHandler('.', { project: tempDir } as any);
      expect(rootName).to.equal('root-module');
      expect((rootConfig as any).source.path).to.equal('.');

      const dirHandler = handlers.get('dir')!;
      const [dirName, dirConfig] = await dirHandler('moduleA', { project: tempDir } as any);
      expect(dirName.startsWith(':')).to.equal(true);
      expect((dirConfig as any).source.path).to.equal('moduleA');

      const [rootDirName, rootDirConfig] = await dirHandler('.', { project: tempDir } as any);
      expect(rootDirName.startsWith(':')).to.equal(true);
      expect((rootDirConfig as any).source.path).to.equal('.');
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

  it('includes env label and singular summary when listing one module', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'proj', environments: { staging: {} } } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {
        pkg: { source: { type: 'package', package: 'pkg', version: '1.0.0' } },
      },
    } as any);

    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    const infoStub = sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--env', 'staging']);

    expect(displayStub.calledOnce).to.equal(true);
    expect(String(displayStub.firstCall.args[1])).to.include('staging');
    const summary = infoStub
      .getCalls()
      .map((call) => String(call.args[0]))
      .join(' ');
    const plainSummary = stripAnsi(summary);
    expect(plainSummary).to.include('1 module');
    expect(plainSummary).to.not.include('1 modules');
  });

  it('errors when project config is missing for list', async () => {
    sinon.stub(common, 'readConfig').resolves(undefined);
    const errorStub = sinon.stub(cliUi, 'error');
    const warningStub = sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(errorStub.called).to.equal(true);
    expect(warningStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('renders unknown sources and git commits in list output', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'proj' } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {
        noSource: {},
        weird: { source: { type: 'custom', detail: 'odd' } },
        git: { source: { type: 'git', remote: 'https://example.com/repo.git', commit: 'abcdef1234567890' } },
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

  it('includes env label when no modules are installed', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'proj', environments: { staging: {} } } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: {} } as any);
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(console, 'log');

    const cmd = cmdList();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--env', 'staging']);

    expect(displayStub.calledOnce).to.equal(true);
    expect(String(displayStub.firstCall.args[1])).to.include('staging');
  });

  it('errors when environment is missing for removal', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'proj', environments: {} } as any);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    await projectModulesRemoveCommand(['foo'], { project: '/tmp/project', env: 'staging', force: false });

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('errors when project config is missing for removal', async () => {
    sinon.stub(common, 'readConfig').resolves(undefined);
    const errorStub = sinon.stub(cliUi, 'error');
    const infoStub = sinon.stub(cliUi, 'info');

    await projectModulesRemoveCommand(['foo'], { project: '/tmp/project', force: false });

    expect(errorStub.called).to.equal(true);
    expect(infoStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('errors when no modules are installed', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'proj', modules: {} } as any);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    await projectModulesRemoveCommand(['foo'], { project: '/tmp/project', force: false });

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('errors when none of the specified modules are installed', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'proj', modules: { foo: {} } } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: { foo: {} } } as any);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    await projectModulesRemoveCommand(['bar'], { project: '/tmp/project', force: false });

    expect(errorStub.called).to.equal(true);
  });

  it('errors when some modules are missing without force', async () => {
    const config: any = {
      modules: {
        foo: { source: { type: 'package', package: 'foo', version: '1.0.0' } },
        bar: { source: { type: 'package', package: 'bar', version: '1.0.0' } },
      },
    };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: { foo: {}, bar: {} } } as any);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    const writeStub = sinon.stub(common, 'writeConfig').resolves();

    await projectModulesRemoveCommand(['foo', 'missing'], { project: '/tmp/project', force: false });

    expect(errorStub.called).to.equal(true);
    expect(writeStub.called).to.equal(false);
  });

  it('removes prefixed modules and warns about remaining dependencies', async () => {
    const config: any = {
      modules: {
        ':foo': { source: { type: 'package', package: 'foo', version: '1.0.0' } },
        bar: { source: { type: 'package', package: 'bar', version: '1.0.0' } },
      },
    };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: { ':foo': {}, bar: {} } } as any);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    const warningStub = sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');

    await projectModulesRemoveCommand(['foo'], { project: '/tmp/project', force: false });

    expect(writeStub.calledOnce).to.equal(true);
    expect(warningStub.called).to.equal(true);
  });

  it('warns when duplicate removals are requested', async () => {
    const config: any = {
      modules: {
        foo: { source: { type: 'package', package: 'foo', version: '1.0.0' } },
      },
    };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: { foo: {} } } as any);
    const warningStub = sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');
    sinon.stub(common, 'writeConfig').resolves();

    await projectModulesRemoveCommand(['foo', 'foo'], { project: '/tmp/project', force: false });

    expect(warningStub.called).to.equal(true);
  });

  it('reports when no modules were removed', async () => {
    const config: any = {
      modules: {
        foo: { source: { type: 'package', package: 'foo', version: '1.0.0' } },
      },
    };
    sinon.stub(common, 'readConfig').resolves(config);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({ modules: { foo: {} } } as any);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');

    await projectModulesRemoveCommand([], { project: '/tmp/project', force: false });

    expect(errorStub.called).to.equal(true);
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

  it('errors when project config is missing for update', async () => {
    sinon.stub(common, 'readConfig').resolves(undefined);
    const errorStub = sinon.stub(cliUi, 'error');
    const infoStub = sinon.stub(cliUi, 'info');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(errorStub.called).to.equal(true);
    expect(infoStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('errors when environment is missing for update', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'proj', environments: {} } as any);
    const errorStub = sinon.stub(cliUi, 'error');
    const infoStub = sinon.stub(cliUi, 'info');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--env', 'staging']);

    expect(errorStub.called).to.equal(true);
    expect(infoStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('errors when no modules are installed for update', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'proj', modules: {} } as any);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(errorStub.called).to.equal(true);
  });

  it('errors when no npm modules are available to update', async () => {
    sinon.stub(common, 'readConfig').resolves({
      name: 'proj',
      modules: { git: { source: { type: 'git', remote: 'https://example.com/repo.git' } } },
    } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: { git: { source: { type: 'git', remote: 'https://example.com/repo.git' } } },
    } as any);
    const errorStub = sinon.stub(cliUi, 'error');
    const infoStub = sinon.stub(cliUi, 'info');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(errorStub.called).to.equal(true);
    expect(infoStub.called).to.equal(true);
  });

  it('reports errors when npm view fails', async () => {
    sinon.stub(common, 'readConfig').resolves({
      name: 'proj',
      modules: { pkg: { source: { type: 'package', package: 'pkg', version: '1.0.0' } } },
    } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: { pkg: { source: { type: 'package', package: 'pkg', version: '1.0.0' } } },
    } as any);
    sinon.stub(command, 'ExecuteCMD').resolves({ code: 1, stdout: '', stderr: 'oops' });
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', 'pkg']);

    expect(errorStub.called).to.equal(true);
  });

  it('reports non-error failures when npm view throws', async () => {
    sinon.stub(common, 'readConfig').resolves({
      name: 'proj',
      modules: { pkg: { source: { type: 'package', package: 'pkg', version: '1.0.0' } } },
    } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: { pkg: { source: { type: 'package', package: 'pkg', version: '1.0.0' } } },
    } as any);
    sinon.stub(command, 'ExecuteCMD').callsFake(() => Promise.reject('boom'));

    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', 'pkg']);

    expect(errorStub.called).to.equal(true);
    expect(String(errorStub.firstCall.args[0])).to.include('boom');
  });

  it('reports when modules are already up to date', async () => {
    sinon.stub(common, 'readConfig').resolves({
      name: 'proj',
      modules: { pkg: { source: { type: 'package', package: 'pkg', version: '1.0.0' } } },
    } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: { pkg: { source: { type: 'package', package: 'pkg', version: '1.0.0' } } },
    } as any);
    sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '1.0.0', stderr: '' });
    const successStub = sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');

    const cmd = cmdUpdate();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', 'pkg']);

    expect(successStub.called).to.equal(true);
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
    await cmd.parseAsync([
      'node',
      'test',
      '--project',
      '/tmp/project',
      '--dry-run',
      'pkg1',
      'pkgSame',
      'gitMod',
      'missing',
    ]);
  });
});
