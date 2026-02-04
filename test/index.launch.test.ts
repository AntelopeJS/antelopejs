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
        modC: {
          source: { type: 'local', path: '/mods/modC' },
        },
      },
      projectFolder: '/project',
    } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();
    sinon.stub(DownloaderRegistry.prototype, 'load').callsFake(async (_project, _cache, source: any) => {
      const id = source.id;
      const watchDir = id === 'modA' ? ['src', 'lib'] : id === 'modB' ? 'src2' : undefined;
      return [
        {
          name: id,
          version: '1.0.0',
          main: `/mods/${id}`,
          folder: `/mods/${id}`,
          exportsPath: `/mods/${id}/interfaces`,
          exports: {},
          imports: [],
          source: { type: 'local', watchDir },
          loadExports: async () => {},
          reload: async () => {},
        } as any,
      ];
    });

    const localModule = {
      id: 'modA',
      manifest: { source: { type: 'local', watchDir: ['src', 'lib'] }, folder: '/mods/modA' },
      reload: sinon.stub().resolves(),
      construct: sinon.stub().resolves(),
      start: sinon.stub(),
    } as any;

    const localModuleB = {
      id: 'modB',
      manifest: { source: { type: 'local', watchDir: 'src2' }, folder: '/mods/modB' },
      reload: sinon.stub().resolves(),
      construct: sinon.stub().resolves(),
      start: sinon.stub(),
    } as any;

    const localModuleC = {
      id: 'modC',
      manifest: { source: { type: 'local' }, folder: '/mods/modC' },
      reload: sinon.stub().resolves(),
      construct: sinon.stub().resolves(),
      start: sinon.stub(),
    } as any;

    const loaded = new Map<string, any>();
    loaded.set('modA', { module: localModule });
    loaded.set('modB', { module: localModuleB });
    loaded.set('modC', { module: localModuleC });

    let addedModules: any[] = [];
    sinon.stub(ModuleManager.prototype, 'addModules').callsFake(function (this: any, modules: any[]) {
      addedModules = modules;
      this.loaded = loaded;
      return [] as any;
    });
    sinon.stub(ModuleManager.prototype, 'getModule').callsFake((id: string) => {
      return id === 'modA' ? localModule : undefined;
    });
    const constructStub = sinon.stub(ModuleManager.prototype, 'constructAll').resolves();
    const startStub = sinon.stub(ModuleManager.prototype, 'startAll');

    const scanStub = sinon.stub(FileWatcher.prototype, 'scanModule').resolves();
    sinon.stub(FileWatcher.prototype, 'onModuleChanged').callsFake((listener) => {
      listener('modA');
      listener('missing');
    });

    const queueStub = sinon.stub(HotReload.prototype, 'queue').callsFake(function (this: any, moduleId: string) {
      return Promise.resolve(this.reload(moduleId));
    });
    const replStub = sinon.stub(ReplSession.prototype, 'start');

    const manager = await launch('/project', 'default', { watch: true, interactive: true });
    const queuePromises = queueStub
      .getCalls()
      .map((call) => call.returnValue as any)
      .filter((value: any) => value && typeof value.then === 'function');
    await Promise.all(queuePromises);

    expect(manager).to.be.instanceOf(ModuleManager);
    expect(constructStub.calledOnce).to.equal(true);
    expect(startStub.calledOnce).to.equal(true);
    expect(scanStub.calledWith('modA', '/mods/modA', ['src', 'lib'])).to.equal(true);
    expect(scanStub.calledWith('modB', '/mods/modB', ['src2'])).to.equal(true);
    expect(scanStub.calledWith('modC', '/mods/modC', [''])).to.equal(true);
    expect(queueStub.calledWith('modA')).to.equal(true);
    expect(replStub.calledWith('> ')).to.equal(true);
    expect(localModule.reload.called).to.equal(true);
    expect(localModule.construct.called).to.equal(true);
    expect(localModule.start.called).to.equal(true);
    const modAConfig = addedModules.find((entry) => entry.manifest.name === 'modA')?.config;
    expect(modAConfig.importOverrides.get('core@beta')).to.deep.equal([{ module: 'provider', id: 'v1' }]);
    expect(Array.from(modAConfig.disabledExports)).to.deep.equal(['foo']);
  });

  it('handles absolute cache folders and empty modules in watch mode', async () => {
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      cacheFolder: '/abs/cache',
      projectFolder: '/project',
    } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();

    const addModulesStub = sinon.stub(ModuleManager.prototype, 'addModules').callsFake(function (
      this: any,
      _modules: any[],
    ) {
      this.loaded = undefined;
      return [] as any;
    });
    const constructStub = sinon.stub(ModuleManager.prototype, 'constructAll').resolves();
    const startStub = sinon.stub(ModuleManager.prototype, 'startAll');

    const scanStub = sinon.stub(FileWatcher.prototype, 'scanModule').resolves();
    const onChangedStub = sinon.stub(FileWatcher.prototype, 'onModuleChanged');
    const queueStub = sinon.stub(HotReload.prototype, 'queue').resolves();

    const manager = await launch('/project', 'default', { watch: true });

    expect(manager).to.be.instanceOf(ModuleManager);
    expect(addModulesStub.calledOnce).to.equal(true);
    expect(addModulesStub.firstCall.args[0]).to.deep.equal([]);
    expect(constructStub.calledOnce).to.equal(true);
    expect(startStub.calledOnce).to.equal(true);
    expect(scanStub.called).to.equal(false);
    expect(onChangedStub.calledOnce).to.equal(true);
    expect(queueStub.called).to.equal(false);
  });

  it('uses manager config when reloading modules', async () => {
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      cacheFolder: '.antelope/cache',
      modules: {
        modA: {
          source: { type: 'local', path: '/mods/modA' },
        },
      },
      projectFolder: '/project',
    } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();
    sinon.stub(DownloaderRegistry.prototype, 'load').resolves([
      {
        name: 'modA',
        version: '1.0.0',
        main: '/mods/modA',
        folder: '/mods/modA',
        exportsPath: '/mods/modA/interfaces',
        exports: {},
        imports: [],
        source: { type: 'local', watchDir: 'src' },
        loadExports: async () => {},
        reload: async () => {},
      } as any,
    ]);

    const localModule = {
      id: 'modA',
      manifest: { source: { type: 'local', watchDir: 'src' }, folder: '/mods/modA' },
      reload: sinon.stub().resolves(),
      construct: sinon.stub().resolves(),
      start: sinon.stub(),
    } as any;

    const loaded = new Map<string, any>();
    loaded.set('modA', { module: localModule });

    sinon.stub(ModuleManager.prototype, 'addModules').callsFake(function (this: any) {
      this.loaded = loaded;
      this.config = { config: { debug: true } };
      return [] as any;
    });
    sinon.stub(ModuleManager.prototype, 'getModule').returns(localModule);
    sinon.stub(ModuleManager.prototype, 'constructAll').resolves();
    sinon.stub(ModuleManager.prototype, 'startAll');

    sinon.stub(FileWatcher.prototype, 'scanModule').resolves();
    sinon.stub(FileWatcher.prototype, 'onModuleChanged').callsFake((listener) => {
      listener('modA');
    });

    const queueStub = sinon.stub(HotReload.prototype, 'queue').callsFake(function (this: any, moduleId: string) {
      return Promise.resolve(this.reload(moduleId));
    });

    const manager = await launch('/project', 'default', { watch: true });
    const queuePromises = queueStub
      .getCalls()
      .map((call) => call.returnValue as any)
      .filter((value: any) => value && typeof value.then === 'function');
    await Promise.all(queuePromises);

    expect(manager).to.be.instanceOf(ModuleManager);
    expect(localModule.construct.calledWith({ debug: true })).to.equal(true);
  });
});
