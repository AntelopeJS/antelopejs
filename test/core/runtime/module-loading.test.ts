import { expect } from 'chai';
import sinon from 'sinon';
import {
  constructAndStartModules,
  ensureGraphIsValid,
  getWatchDirs,
  registerCoreModuleInterface,
  reloadWatchedModule,
} from '../../../src/core/runtime/module-loading';
import { ModuleManager } from '../../../src/core/module-manager';
import * as moduleInterfaceBeta from '../../../src/interfaces/core/beta/modules';
import { terminalDisplay } from '../../../src/core/cli/terminal-display';

function createLoadedModules(entries: any[]): IterableIterator<any> {
  return entries[Symbol.iterator]();
}

describe('runtime module-loading', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('resolves watch directories for all source variants', () => {
    expect(getWatchDirs({ type: 'git' } as any)).to.deep.equal(['']);
    expect(getWatchDirs({ type: 'local', watchDir: ['src', 'lib'] } as any)).to.deep.equal(['src', 'lib']);
    expect(getWatchDirs({ type: 'local', watchDir: 'src' } as any)).to.deep.equal(['src']);
    expect(getWatchDirs({ type: 'local' } as any)).to.deep.equal(['']);
  });

  it('validates graph issues and missing interfaces', () => {
    const validManager = {
      getLoadedModules: () =>
        createLoadedModules([
          {
            module: { id: 'alpha', manifest: { imports: ['db@beta'] } },
          },
        ]),
      resolver: {
        moduleAssociations: new Map([['alpha', new Map([['db@beta', {}]])]]),
      },
    } as any;

    expect(() => ensureGraphIsValid(validManager)).to.not.throw();

    const invalidManager = {
      getLoadedModules: () =>
        createLoadedModules([
          {
            module: { id: 'alpha', manifest: { imports: ['db@beta'] } },
          },
        ]),
      resolver: {
        moduleAssociations: new Map([['alpha', new Map()]]),
      },
    } as any;

    expect(() => ensureGraphIsValid(invalidManager)).to.throw('alpha -> db@beta');
  });

  it('reloads watched modules and ignores unknown ones', async () => {
    const managerWithoutEntry = {
      getModuleEntry: sinon.stub().returns(undefined),
      unrequireModuleFiles: sinon.stub(),
    } as any;

    await reloadWatchedModule(managerWithoutEntry, 'unknown');
    expect(managerWithoutEntry.unrequireModuleFiles.called).to.equal(false);

    const entry = {
      module: {
        reload: sinon.stub().resolves(),
        construct: sinon.stub().resolves(),
        start: sinon.stub(),
      },
      config: {
        config: { enabled: true },
      },
    };

    const managerWithEntry = {
      getModuleEntry: sinon.stub().returns(entry),
      unrequireModuleFiles: sinon.stub(),
    } as any;

    await reloadWatchedModule(managerWithEntry, 'alpha');

    expect(managerWithEntry.unrequireModuleFiles.calledWith('alpha')).to.equal(true);
    expect(entry.module.reload.calledOnce).to.equal(true);
    expect(entry.module.construct.calledWith({ enabled: true })).to.equal(true);
    expect(entry.module.start.calledOnce).to.equal(true);
  });

  it('constructs and starts modules, and fails gracefully on construct errors', async () => {
    sinon.stub(terminalDisplay, 'startSpinner').resolves();
    const stopSpinnerStub = sinon.stub(terminalDisplay, 'stopSpinner').resolves();
    const failSpinnerStub = sinon.stub(terminalDisplay, 'failSpinner').resolves();

    const manager = {
      constructAll: sinon.stub().resolves(),
      startAll: sinon.stub(),
    } as any;

    await constructAndStartModules(manager);

    expect(stopSpinnerStub.calledWith('Done loading')).to.equal(true);
    expect(manager.startAll.calledOnce).to.equal(true);
    expect(failSpinnerStub.called).to.equal(false);

    const failingManager = {
      constructAll: sinon.stub().rejects(new Error('construct failed')),
      startAll: sinon.stub(),
    } as any;

    let thrown: unknown;
    try {
      await constructAndStartModules(failingManager);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect(failSpinnerStub.calledWith('Failed to construct modules')).to.equal(true);
    expect(failingManager.startAll.called).to.equal(false);
  });

  it('handles module interface operations and error branches', async () => {
    const listModulesStub = sinon.stub().returns(['alpha']);
    const getModuleEntryStub = sinon.stub();
    const getLoadedModuleEntryStub = sinon.stub();
    const addModulesStub = sinon.stub().returns([{ module: { id: 'alpha' }, config: {} }]);
    const constructModulesStub = sinon.stub().resolves();
    const startModulesStub = sinon.stub();
    const getModuleStub = sinon.stub();
    const replaceLoadedModuleStub = sinon.stub();
    const refreshAssociationsStub = sinon.stub();
    const manager = {
      listModules: listModulesStub,
      getModuleEntry: getModuleEntryStub,
      getLoadedModuleEntry: getLoadedModuleEntryStub,
      addModules: addModulesStub,
      constructModules: constructModulesStub,
      startModules: startModulesStub,
      getModule: getModuleStub,
      replaceLoadedModule: replaceLoadedModuleStub,
      refreshAssociations: refreshAssociationsStub,
    } as unknown as ModuleManager;

    const registryLoadStub = sinon.stub();
    const loaderContext = {
      fs: {} as any,
      cache: {} as any,
      projectFolder: '/project',
      registry: {
        load: registryLoadStub,
      },
    } as any;

    registerCoreModuleInterface(manager, loaderContext);

    manager.getModuleEntry = sinon.stub().returns(undefined) as any;
    let infoError: unknown;
    try {
      await moduleInterfaceBeta.GetModuleInfo('missing');
    } catch (error) {
      infoError = error;
    }
    expect(infoError).to.be.instanceOf(Error);

    manager.getModule = sinon.stub().returns(undefined) as any;
    await moduleInterfaceBeta.StartModule('unknown');
    await moduleInterfaceBeta.StopModule('unknown');
    await moduleInterfaceBeta.DestroyModule('unknown');

    manager.getLoadedModuleEntry = sinon.stub().returns(undefined) as any;
    await moduleInterfaceBeta.ReloadModule('unknown');

    manager.getModuleEntry = sinon.stub().returns({
      module: { state: 'unexpected', manifest: { source: { type: 'local' }, folder: '/mods/alpha' } },
      config: {
        config: {},
      },
    }) as any;

    const info = await moduleInterfaceBeta.GetModuleInfo('alpha');
    expect(info.status).to.equal('unknown');
    expect(info.importOverrides).to.deep.equal({});
    expect(info.disabledExports).to.deep.equal([]);

    const manifest = {
      name: 'alpha',
      version: '1.0.0',
      main: '/mods/alpha/index.js',
      folder: '/mods/alpha',
      exportsPath: '/mods/alpha/interfaces',
      exports: {},
      imports: [],
      source: { type: 'local', path: '/mods/alpha' },
      loadExports: sinon.stub().resolves(),
      reload: sinon.stub().resolves(),
    } as any;

    registryLoadStub.resolves([manifest]);
    await moduleInterfaceBeta.LoadModule('alpha', { source: { type: 'local', path: '/mods/alpha' } }, false);
    expect(startModulesStub.called).to.equal(false);

    manager.getLoadedModuleEntry = sinon.stub().returns({
      module: {
        manifest: { source: { type: 'local', path: '/mods/alpha' } },
        destroy: sinon.stub().resolves(),
      },
      config: {
        config: {},
      },
    }) as any;

    registryLoadStub.resolves([]);
    let reloadNoManifestError: unknown;
    try {
      await moduleInterfaceBeta.ReloadModule('alpha');
    } catch (error) {
      reloadNoManifestError = error;
    }
    expect(reloadNoManifestError).to.be.instanceOf(Error);

    registryLoadStub.resolves([
      {
        ...manifest,
        name: 'different-id',
      },
    ]);

    let reloadMismatchError: unknown;
    try {
      await moduleInterfaceBeta.ReloadModule('alpha');
    } catch (error) {
      reloadMismatchError = error;
    }
    expect(reloadMismatchError).to.be.instanceOf(Error);
  });
});
