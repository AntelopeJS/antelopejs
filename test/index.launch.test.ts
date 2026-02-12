import { expect } from 'chai';
import sinon from 'sinon';
import { launch } from '../src/index';
import { ConfigLoader } from '../src/core/config/config-loader';
import { ModuleCache } from '../src/core/module-cache';
import { ModuleManager } from '../src/core/module-manager';
import { DownloaderRegistry } from '../src/core/downloaders/registry';
import { FileWatcher } from '../src/core/watch/file-watcher';
import { HotReload } from '../src/core/watch/hot-reload';
import { ReplSession } from '../src/core/repl/repl-session';

describe('launch', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('starts watch and interactive flows when enabled', async () => {
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      cacheFolder: '.antelope/cache',
      modules: {
        modA: {
          source: { type: 'local', path: '/mods/modA' },
          config: { flag: true },
          disabledExports: ['foo'],
          importOverrides: [{ interface: 'core@beta', source: 'provider', id: 'v1' }],
        },
        modB: {
          source: { type: 'local', path: '/mods/modB' },
        },
      },
      projectFolder: '/project',
    } as any);

    sinon.stub(ModuleCache.prototype, 'load').resolves();
    sinon.stub(DownloaderRegistry.prototype, 'load').callsFake(async (_project, _cache, source: any) => {
      const id = source.id;
      const watchDir = id === 'modA' ? ['src', 'lib'] : 'src2';
      return [
        {
          name: id,
          version: '1.0.0',
          main: __filename,
          folder: `/mods/${id}`,
          exportsPath: `/mods/${id}/interfaces`,
          exports: {},
          imports: [],
          source: { type: 'local', path: `/mods/${id}`, watchDir },
          loadExports: async () => {},
          reload: async () => {},
        } as any,
      ];
    });

    const localModule = {
      id: 'modA',
      manifest: {
        source: { type: 'local', path: '/mods/modA', watchDir: ['src', 'lib'] },
        folder: '/mods/modA',
        exports: {},
        imports: [],
      },
      destroy: sinon.stub().resolves(),
      reload: sinon.stub().resolves(),
      construct: sinon.stub().resolves(),
      start: sinon.stub(),
    } as any;
    const localModuleB = {
      id: 'modB',
      manifest: {
        source: { type: 'local', path: '/mods/modB', watchDir: 'src2' },
        folder: '/mods/modB',
        exports: {},
        imports: [],
      },
      destroy: sinon.stub().resolves(),
      reload: sinon.stub().resolves(),
      construct: sinon.stub().resolves(),
      start: sinon.stub(),
    } as any;

    const loaded = new Map<string, any>([
      ['modA', { module: localModule, config: { config: { flag: true } } }],
      ['modB', { module: localModuleB, config: { config: { debug: true } } }],
    ]);

    let addedModules: any[] = [];
    sinon.stub(ModuleManager.prototype, 'addModules').callsFake(function (this: any, modules: any[]) {
      addedModules = modules;
      this.loaded = loaded;
      return [] as any;
    });

    sinon.stub(ModuleManager.prototype, 'constructAll').resolves();
    sinon.stub(ModuleManager.prototype, 'startAll');

    const scanStub = sinon.stub(FileWatcher.prototype, 'scanModule').resolves();
    sinon.stub(FileWatcher.prototype, 'onModuleChanged').callsFake((listener) => listener('modA'));
    const startWatchingStub = sinon.stub(FileWatcher.prototype, 'startWatching');

    const queueStub = sinon.stub(HotReload.prototype, 'queue').callsFake(function (this: any, moduleId: string) {
      return Promise.resolve(this.reload(moduleId));
    });

    const replStub = sinon.stub(ReplSession.prototype, 'start');

    const manager = await launch('/project', 'default', { watch: true, interactive: true });
    await Promise.all(
      queueStub
        .getCalls()
        .map((call) => call.returnValue)
        .filter((value: any) => value && typeof value.then === 'function'),
    );

    expect(manager).to.be.instanceOf(ModuleManager);
    expect(scanStub.calledWith('modA', '/mods/modA', ['src', 'lib'])).to.equal(true);
    expect(scanStub.calledWith('modB', '/mods/modB', ['src2'])).to.equal(true);
    expect(startWatchingStub.calledOnce).to.equal(true);
    expect(replStub.calledWith('> ')).to.equal(true);
    expect(localModule.destroy.calledOnce).to.equal(true);

    const modAConfig = addedModules.find((entry) => entry.manifest.name === 'modA')?.config;
    expect(modAConfig.importOverrides.get('core@beta')).to.deep.equal([{ module: 'provider', id: 'v1' }]);
    expect(Array.from(modAConfig.disabledExports)).to.deep.equal(['foo']);
  });

  it('handles empty loaded modules in watch mode', async () => {
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      cacheFolder: '/abs/cache',
      projectFolder: '/project',
      modules: {},
    } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();

    sinon.stub(ModuleManager.prototype, 'addModules').callsFake(function (this: any) {
      this.loaded = undefined;
      return [] as any;
    });
    sinon.stub(ModuleManager.prototype, 'constructAll').resolves();
    sinon.stub(ModuleManager.prototype, 'startAll');

    const scanStub = sinon.stub(FileWatcher.prototype, 'scanModule').resolves();
    sinon.stub(FileWatcher.prototype, 'onModuleChanged');
    sinon.stub(HotReload.prototype, 'queue').resolves();
    const startWatchingStub = sinon.stub(FileWatcher.prototype, 'startWatching');

    const manager = await launch('/project', 'default', { watch: true });

    expect(manager).to.be.instanceOf(ModuleManager);
    expect(scanStub.called).to.equal(false);
    expect(startWatchingStub.calledOnce).to.equal(true);
  });
});
