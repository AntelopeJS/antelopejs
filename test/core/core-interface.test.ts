import { expect } from 'chai';
import sinon from 'sinon';
import { launch } from '../../src/index';
import { ConfigLoader } from '../../src/core/config/config-loader';
import { ModuleCache } from '../../src/core/module-cache';
import { DownloaderRegistry } from '../../src/core/downloaders/registry';
import { ModuleManager } from '../../src/core/module-manager';
import { Module } from '../../src/core/module';
import * as moduleInterfaceBeta from '../../src/interfaces/core/beta/modules';
import { internal } from '../../src/interfaces/core/beta';

describe('core/beta module interface', () => {
  afterEach(() => {
    sinon.restore();
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it('exposes module operations over the core interface', async () => {
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      cacheFolder: '.antelope/cache',
      modules: {},
      projectFolder: '/project',
    } as any);
    sinon.stub(ModuleCache.prototype, 'load').resolves();

    const manifestStub = {
      name: 'modA',
      version: '1.0.0',
      main: '/mods/modA/index.js',
      folder: '/mods/modA',
      exportsPath: '/mods/modA/interfaces',
      exports: {},
      imports: [],
      source: { type: 'local', path: '/mods/modA' },
      loadExports: sinon.stub().resolves(),
    } as any;

    const loadStub = sinon.stub(DownloaderRegistry.prototype, 'load');
    loadStub.onCall(0).resolves([manifestStub]);
    loadStub.onCall(1).resolves([manifestStub]);

    const entry = {
      module: {
        id: 'modA',
        state: 'active',
        manifest: { source: { type: 'local', path: '/mods/modA' }, folder: '/mods/modA' },
        destroy: sinon.stub().resolves(),
      },
      config: {
        config: { enabled: true },
        disabledExports: new Set(['foo']),
        importOverrides: new Map([['core@beta', [{ module: 'provider', id: 'v1' }]]]),
      },
    };

    sinon.stub(ModuleManager.prototype, 'listModules').returns(['modA', 'modB']);
    sinon.stub(ModuleManager.prototype, 'getModuleEntry').returns(entry as any);
    sinon.stub(ModuleManager.prototype, 'getLoadedModuleEntry').returns(entry as any);
    sinon.stub(ModuleManager.prototype, 'addModules').returns([{ module: { id: 'modA' }, config: entry.config } as any]);
    const constructStub = sinon.stub(ModuleManager.prototype, 'constructModules').resolves();
    const startStub = sinon.stub(ModuleManager.prototype, 'startModules');
    const replaceStub = sinon.stub(ModuleManager.prototype, 'replaceLoadedModule').returns(entry as any);
    const refreshStub = sinon.stub(ModuleManager.prototype, 'refreshAssociations');

    sinon.stub(Module.prototype, 'construct').resolves();
    sinon.stub(Module.prototype, 'start').returns();

    await launch('/project', 'default', {});

    const list = await moduleInterfaceBeta.ListModules();
    expect(list).to.deep.equal(['modA', 'modB']);

    const info = await moduleInterfaceBeta.GetModuleInfo('modA');
    expect(info.status).to.equal('active');
    expect(info.importOverrides['core@beta']).to.deep.equal(['provider']);
    expect(info.disabledExports).to.deep.equal(['foo']);

    const loadedIds = await moduleInterfaceBeta.LoadModule(
      'modA',
      {
        source: { type: 'local', path: '/mods/modA' },
        config: { enabled: true },
        importOverrides: { 'core@beta': ['provider'] },
        disabledExports: ['foo'],
      },
      true,
    );
    expect(loadedIds).to.deep.equal(['modA']);
    expect(constructStub.calledOnce).to.equal(true);
    expect(startStub.calledOnce).to.equal(true);

    await moduleInterfaceBeta.ReloadModule('modA');
    expect(replaceStub.calledOnce).to.equal(true);
    expect(refreshStub.calledOnce).to.equal(true);

    let error: unknown;
    try {
      await moduleInterfaceBeta.LoadModule('bad', { source: { type: 'unknown' } as any }, false);
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(Error);
  });
});
