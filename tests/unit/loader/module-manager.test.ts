import { expect, sinon } from '../../helpers/setup';
import proxyquire from 'proxyquire';

describe('loader/ModuleManager', () => {
  let ModuleManager: any;
  let mockCache: any;
  let mockLoadModule: sinon.SinonStub;
  let mockModule: any;
  let mockTerminalDisplay: any;
  let mockCoreInterfaceBeta: any;
  let mockModuleInterfaceBeta: any;
  let mockModuleClass: sinon.SinonStub;
  let mockModuleCacheClass: sinon.SinonStub;
  let mockModuleManifest: any;
  let mockModuleManifestClass: sinon.SinonStub;

  beforeEach(() => {
    // Mock cache
    mockCache = {
      load: sinon.stub().resolves(),
      getFolder: sinon.stub().resolves('/cache/folder'),
      getVersion: sinon.stub().returns('1.0.0'),
      setVersion: sinon.stub(),
    };

    mockModuleCacheClass = sinon.stub().returns(mockCache);

    // Mock terminal display
    mockTerminalDisplay = {
      startSpinner: sinon.stub().resolves(),
      stopSpinner: sinon.stub().resolves(),
      failSpinner: sinon.stub().resolves(),
      cleanSpinner: sinon.stub().resolves(),
    };

    // Mock ModuleManifest for core module
    mockModuleManifest = {
      folder: '/antelope',
      exportsPath: '/antelope/interfaces',
      source: { type: 'none', id: 'antelopejs' },
      exports: { 'core@beta': '/antelope/interfaces/core/beta' },
      imports: [],
      loadExports: sinon.stub().resolves(),
      name: 'antelopejs',
      version: '1.0.0',
    };

    mockModuleManifestClass = sinon.stub().returns(mockModuleManifest);

    // Mock module
    mockModule = {
      construct: sinon.stub().resolves(),
      start: sinon.stub(),
      stop: sinon.stub(),
      destroy: sinon.stub().resolves(),
      id: 'test-module',
      version: '1.0.0',
      stateStr: 'loaded',
      manifest: {
        folder: '/path/to/module',
        exportsPath: '/path/to/module/interfaces',
        source: { type: 'local', id: 'test-module' },
        exports: {},
        imports: [],
        loadExports: sinon.stub().resolves(),
        name: 'test-module',
        version: '1.0.0',
      },
    };

    mockModuleClass = sinon.stub().returns(mockModule);

    // Mock LoadModule
    mockLoadModule = sinon.stub().resolves([
      {
        name: 'test-module',
        version: '1.0.0',
        folder: '/path/to/module',
        exportsPath: '/path/to/module/interfaces',
        source: { type: 'local', id: 'test-module' },
        imports: [],
        exports: {},
        loadExports: sinon.stub().resolves(),
      },
    ]);

    // Mock core interface beta
    mockCoreInterfaceBeta = {
      internal: {
        interfaceConnections: {},
        moduleByFolder: [],
        knownAsync: new Map(),
        knownRegisters: new Map(),
        knownEvents: [],
      },
      ImplementInterface: sinon.stub(),
    };

    // Mock module interface beta
    mockModuleInterfaceBeta = {
      Events: {
        ModuleConstructed: { emit: sinon.stub() },
        ModuleStarted: { emit: sinon.stub() },
        ModuleStopped: { emit: sinon.stub() },
        ModuleDestroyed: { emit: sinon.stub() },
      },
    };

    // Proxy the module
    const loaderModule = proxyquire('../../../src/loader/index', {
      '../common/cache': { ModuleCache: mockModuleCacheClass },
      '../common/downloader': { default: mockLoadModule },
      '../common/manifest': { ModuleManifest: mockModuleManifestClass },
      './module': { Module: mockModuleClass },
      '../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      '../interfaces/core/beta': mockCoreInterfaceBeta,
      '../interfaces/core/beta/modules': mockModuleInterfaceBeta,
      '../interfaces/logging/beta': {
        Logging: {
          Channel: sinon.stub().returns({
            Debug: sinon.stub(),
            Trace: sinon.stub(),
            Info: sinon.stub(),
            Error: sinon.stub(),
            Warn: sinon.stub(),
          }),
        },
      },
    });

    ModuleManager = loaderModule.ModuleManager;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('should create manager with correct projectFolder', () => {
      const manager = new ModuleManager('/project', '/antelope', '/cache');
      // The manager should be created without error
      expect(manager).to.exist;
    });

    it('should create ModuleCache with cacheFolder', () => {
      new ModuleManager('/project', '/antelope', '/cache');
      expect(mockModuleCacheClass).to.have.been.calledWith('/cache');
    });

    it('should add core module (antelopejs) to loadedModules', () => {
      const manager = new ModuleManager('/project', '/antelope', '/cache');
      expect(manager.loadedModules.has('antelopejs')).to.be.true;
    });

    it('should set default concurrency from EventEmitter.defaultMaxListeners', () => {
      const manager = new ModuleManager('/project', '/antelope', '/cache');
      // Should not throw and manager should be created
      expect(manager).to.exist;
    });

    it('should accept custom concurrency value', () => {
      const manager = new ModuleManager('/project', '/antelope', '/cache', 50);
      expect(manager).to.exist;
    });

    it('should create ModuleManifest for antelopejs core', () => {
      new ModuleManager('/project', '/antelope', '/cache');
      expect(mockModuleManifestClass).to.have.been.calledWith('/antelope', { id: 'antelopejs', type: 'none' }, 'antelopejs');
    });
  });

  describe('init', () => {
    let manager: any;

    beforeEach(() => {
      manager = new ModuleManager('/project', '/antelope', '/cache');
    });

    it('should load cache', async () => {
      await manager.init({ sources: [], configs: {} });
      expect(mockCache.load).to.have.been.calledOnce;
    });

    it('should implement module interface', async () => {
      await manager.init({ sources: [], configs: {} });
      expect(mockCoreInterfaceBeta.ImplementInterface).to.have.been.called;
    });

    it('should start loading spinner', async () => {
      await manager.init({ sources: [], configs: {} });
      expect(mockTerminalDisplay.startSpinner).to.have.been.calledWith('Loading modules');
    });

    it('should stop loading spinner after modules are loaded', async () => {
      await manager.init({ sources: [], configs: {} });
      expect(mockTerminalDisplay.stopSpinner).to.have.been.calledWith('Modules loaded');
    });

    it('should load modules from manifest sources', async () => {
      const manifest = {
        sources: [{ id: 'test-module', type: 'local', path: '/path/to/module' }],
        configs: { 'test-module': { importOverrides: new Map(), disabledExports: new Set(), config: {} } },
      };

      await manager.init(manifest);

      expect(mockLoadModule).to.have.been.calledOnce;
    });

    it('should create Module instances for each loaded manifest', async () => {
      const manifest = {
        sources: [{ id: 'test-module', type: 'local', path: '/path/to/module' }],
        configs: { 'test-module': { importOverrides: new Map(), disabledExports: new Set(), config: {} } },
      };

      await manager.init(manifest);

      expect(mockModuleClass).to.have.been.called;
    });

    it('should load exports for all modules', async () => {
      const manifest = {
        sources: [{ id: 'test-module', type: 'local', path: '/path/to/module' }],
        configs: { 'test-module': { importOverrides: new Map(), disabledExports: new Set(), config: {} } },
      };

      await manager.init(manifest);

      expect(mockTerminalDisplay.startSpinner).to.have.been.calledWith('Loading exports');
      expect(mockTerminalDisplay.stopSpinner).to.have.been.calledWith('Exports loaded');
    });

    it('should construct all modules', async () => {
      const manifest = {
        sources: [{ id: 'test-module', type: 'local', path: '/path/to/module' }],
        configs: { 'test-module': { importOverrides: new Map(), disabledExports: new Set(), config: {} } },
      };

      await manager.init(manifest);

      expect(mockModule.construct).to.have.been.called;
    });

    it('should handle module loading errors gracefully', async () => {
      // Make LoadModule fail
      mockLoadModule.rejects(new Error('Failed to load'));
      mockTerminalDisplay.failSpinner.resolves();

      const manifest = {
        sources: [{ id: 'failing-module', type: 'local', path: '/path/to/failing' }],
        configs: {},
      };

      // Mock process.exit to prevent test from exiting and throw instead
      const exitStub = sinon.stub(process, 'exit').throws(new Error('exit called'));

      try {
        await manager.init(manifest);
      } catch (e: any) {
        // Expected to throw due to process.exit stub
        expect(e.message).to.equal('exit called');
      }

      expect(mockTerminalDisplay.failSpinner).to.have.been.called;
      exitStub.restore();
    });

    it('should add loaded modules to loadedModules map', async () => {
      const manifest = {
        sources: [{ id: 'test-module', type: 'local', path: '/path/to/module' }],
        configs: { 'test-module': { importOverrides: new Map(), disabledExports: new Set(), config: {} } },
      };

      await manager.init(manifest);

      // The module should be added
      expect(manager.loadedModules.size).to.be.greaterThan(1); // core + test module
    });

    it('should show constructing modules spinner', async () => {
      const manifest = {
        sources: [{ id: 'test-module', type: 'local', path: '/path/to/module' }],
        configs: { 'test-module': { importOverrides: new Map(), disabledExports: new Set(), config: {} } },
      };

      await manager.init(manifest);

      expect(mockTerminalDisplay.startSpinner).to.have.been.calledWith('Constructing modules');
      expect(mockTerminalDisplay.stopSpinner).to.have.been.calledWith('Done loading');
    });

    it('should register interface implementation functions', async () => {
      await manager.init({ sources: [], configs: {} });

      // Check that ImplementInterface was called with the module interface functions
      expect(mockCoreInterfaceBeta.ImplementInterface).to.have.been.called;
      const implementCall = mockCoreInterfaceBeta.ImplementInterface.firstCall;
      expect(implementCall.args[1]).to.have.property('ListModules');
      expect(implementCall.args[1]).to.have.property('GetModuleInfo');
      expect(implementCall.args[1]).to.have.property('LoadModule');
      expect(implementCall.args[1]).to.have.property('StartModule');
      expect(implementCall.args[1]).to.have.property('StopModule');
      expect(implementCall.args[1]).to.have.property('DestroyModule');
      expect(implementCall.args[1]).to.have.property('ReloadModule');
    });

    it('should load exports for core module', async () => {
      await manager.init({ sources: [], configs: {} });
      // The core module's manifest is the mockModuleManifest we created
      // The manager gets this via this.core.ref.manifest.loadExports()
      // Since this.core is set up in constructor, we verify the core entry exists
      expect(manager.loadedModules.get('antelopejs')).to.exist;
      // And the mock manifest's loadExports should have been called
      const coreEntry = manager.loadedModules.get('antelopejs');
      expect(coreEntry.ref.manifest.loadExports).to.have.been.called;
    });
  });

  describe('startModules', () => {
    let manager: any;

    beforeEach(async () => {
      manager = new ModuleManager('/project', '/antelope', '/cache');
      await manager.init({ sources: [], configs: {} });
    });

    it('should start all loaded modules', async () => {
      // Add a mock module to loadedModules
      const mockModuleRef = {
        start: sinon.stub(),
        destroy: sinon.stub().resolves(),
      };
      manager.loadedModules.set('mock-module', { ref: mockModuleRef, config: {} });

      manager.startModules();

      expect(mockModuleRef.start).to.have.been.calledOnce;
    });

    it('should call start on each module in loadedModules', async () => {
      const mockModule1 = { start: sinon.stub(), destroy: sinon.stub().resolves() };
      const mockModule2 = { start: sinon.stub(), destroy: sinon.stub().resolves() };

      manager.loadedModules.set('module1', { ref: mockModule1, config: {} });
      manager.loadedModules.set('module2', { ref: mockModule2, config: {} });

      manager.startModules();

      expect(mockModule1.start).to.have.been.calledOnce;
      expect(mockModule2.start).to.have.been.calledOnce;
    });
  });

  describe('shutdown', () => {
    let manager: any;

    beforeEach(async () => {
      manager = new ModuleManager('/project', '/antelope', '/cache');
      await manager.init({ sources: [], configs: {} });
    });

    it('should destroy all loaded modules', async () => {
      const mockModuleRef = {
        destroy: sinon.stub().resolves(),
        start: sinon.stub(),
      };
      manager.loadedModules.set('mock-module', { ref: mockModuleRef, config: {} });

      await manager.shutdown();

      expect(mockModuleRef.destroy).to.have.been.calledOnce;
    });

    it('should clear loadedModules map', async () => {
      const mockModuleRef = {
        destroy: sinon.stub().resolves(),
        start: sinon.stub(),
      };
      manager.loadedModules.set('mock-module', { ref: mockModuleRef, config: {} });

      await manager.shutdown();

      expect(manager.loadedModules.size).to.equal(0);
    });

    it('should destroy multiple modules in parallel', async () => {
      const mockModule1 = { destroy: sinon.stub().resolves(), start: sinon.stub() };
      const mockModule2 = { destroy: sinon.stub().resolves(), start: sinon.stub() };

      manager.loadedModules.set('module1', { ref: mockModule1, config: {} });
      manager.loadedModules.set('module2', { ref: mockModule2, config: {} });

      await manager.shutdown();

      expect(mockModule1.destroy).to.have.been.calledOnce;
      expect(mockModule2.destroy).to.have.been.calledOnce;
    });

    it('should handle empty loadedModules gracefully', async () => {
      manager.loadedModules.clear();

      // Should not throw
      await manager.shutdown();

      expect(manager.loadedModules.size).to.equal(0);
    });
  });

  describe('reloadModule', () => {
    let manager: any;
    let existingModule: any;

    beforeEach(async () => {
      manager = new ModuleManager('/project', '/antelope', '/cache');
      await manager.init({ sources: [], configs: {} });

      // Set up an existing module
      existingModule = {
        destroy: sinon.stub().resolves(),
        construct: sinon.stub().resolves(),
        start: sinon.stub(),
        id: 'reload-test',
        manifest: {
          folder: '/path/to/reload-test',
          exportsPath: '/path/to/reload-test/interfaces',
          source: { type: 'local', id: 'reload-test' },
        },
      };

      manager.loadedModules.set('reload-test', {
        ref: existingModule,
        config: { importOverrides: new Map(), disabledExports: new Set(), config: {} },
      });
    });

    it('should destroy the existing module', async () => {
      await manager.reloadModule('reload-test');

      expect(existingModule.destroy).to.have.been.calledOnce;
    });

    it('should create a new Module instance', async () => {
      const initialCallCount = mockModuleClass.callCount;

      await manager.reloadModule('reload-test');

      expect(mockModuleClass.callCount).to.be.greaterThan(initialCallCount);
    });

    it('should construct the new module', async () => {
      await manager.reloadModule('reload-test');

      // New module should be constructed
      expect(mockModule.construct).to.have.been.called;
    });

    it('should start the new module', async () => {
      await manager.reloadModule('reload-test');

      expect(mockModule.start).to.have.been.called;
    });

    it('should handle non-existent module gracefully', async () => {
      // Should not throw for non-existent module
      await manager.reloadModule('non-existent-module');

      // No error should be thrown
    });

    it('should update config if provided', async () => {
      const newConfig = {
        importOverrides: new Map([['logging@beta', [{ module: 'custom-logger' }]]]),
        disabledExports: new Set(['some-export@beta']),
        config: { newOption: true },
      };

      await manager.reloadModule('reload-test', newConfig);

      const updatedEntry = manager.loadedModules.get('reload-test');
      expect(updatedEntry.config).to.equal(newConfig);
    });

    it('should call LoadModule with the module source', async () => {
      const initialCallCount = mockLoadModule.callCount;

      await manager.reloadModule('reload-test');

      expect(mockLoadModule.callCount).to.be.greaterThan(initialCallCount);
    });
  });

  describe('implemented interface functions', () => {
    let manager: any;
    let implementedFunctions: any;

    beforeEach(async () => {
      manager = new ModuleManager('/project', '/antelope', '/cache');
      await manager.init({ sources: [], configs: {} });

      // Get the implemented functions from the ImplementInterface call
      implementedFunctions = mockCoreInterfaceBeta.ImplementInterface.firstCall.args[1];
    });

    describe('ListModules', () => {
      it('should return array of loaded module keys', async () => {
        const modules = await implementedFunctions.ListModules();
        expect(modules).to.include('antelopejs');
      });
    });

    describe('GetModuleInfo', () => {
      it('should return module info for existing module', async () => {
        // Add a test module
        const testModule = {
          ref: {
            manifest: {
              source: { type: 'local', id: 'test' },
              folder: '/path/to/test',
            },
            stateStr: 'active',
          },
          config: {
            config: { option: 'value' },
            disabledExports: new Set(['disabled@beta']),
            importOverrides: new Map([['logging@beta', [{ module: 'logger' }]]]),
          },
        };
        manager.loadedModules.set('test-module', testModule);

        const info = await implementedFunctions.GetModuleInfo('test-module');

        expect(info.source).to.deep.equal({ type: 'local', id: 'test' });
        expect(info.config).to.deep.equal({ option: 'value' });
        expect(info.disabledExports).to.deep.equal(['disabled@beta']);
        expect(info.localPath).to.equal('/path/to/test');
        expect(info.status).to.equal('active');
      });
    });

    describe('StartModule', () => {
      it('should start the specified module', async () => {
        const testModuleRef = { start: sinon.stub() };
        manager.loadedModules.set('start-test', { ref: testModuleRef, config: {} });

        await implementedFunctions.StartModule('start-test');

        expect(testModuleRef.start).to.have.been.calledOnce;
      });

      it('should handle non-existent module gracefully', async () => {
        // Should not throw
        await implementedFunctions.StartModule('non-existent');
      });
    });

    describe('StopModule', () => {
      it('should stop the specified module', async () => {
        const testModuleRef = { stop: sinon.stub() };
        manager.loadedModules.set('stop-test', { ref: testModuleRef, config: {} });

        await implementedFunctions.StopModule('stop-test');

        expect(testModuleRef.stop).to.have.been.calledOnce;
      });
    });

    describe('DestroyModule', () => {
      it('should destroy the specified module', async () => {
        const testModuleRef = { destroy: sinon.stub().resolves() };
        manager.loadedModules.set('destroy-test', { ref: testModuleRef, config: {} });

        await implementedFunctions.DestroyModule('destroy-test');

        expect(testModuleRef.destroy).to.have.been.calledOnce;
      });
    });

    describe('ReloadModule', () => {
      it('should call reloadModule on the manager', async () => {
        const reloadSpy = sinon.spy(manager, 'reloadModule');

        // Add a module to reload
        manager.loadedModules.set('reload-via-interface', {
          ref: {
            destroy: sinon.stub().resolves(),
            manifest: { source: { type: 'local', id: 'reload-via-interface' }, folder: '/path' },
          },
          config: { importOverrides: new Map(), disabledExports: new Set(), config: {} },
        });

        await implementedFunctions.ReloadModule('reload-via-interface');

        expect(reloadSpy).to.have.been.calledWith('reload-via-interface');
      });
    });
  });

  describe('unrequireModuleFiles', () => {
    let manager: any;

    beforeEach(async () => {
      manager = new ModuleManager('/project', '/antelope', '/cache');
      await manager.init({ sources: [], configs: {} });
    });

    it('should delete cached module files from require.cache', () => {
      // Set up a mock module
      const mockModuleEntry = {
        ref: {
          manifest: {
            folder: '/test/module/path',
            exportsPath: '/test/module/path/interfaces',
          },
        },
        config: {},
      };

      // Add some entries to require.cache
      const testFilePath = '/test/module/path/src/index.js';
      const interfaceFilePath = '/test/module/path/interfaces/core/beta.js';
      require.cache[testFilePath] = {} as any;
      require.cache[interfaceFilePath] = {} as any;

      manager.unrequireModuleFiles(mockModuleEntry);

      // Source file should be deleted
      expect(require.cache[testFilePath]).to.be.undefined;
      // Interface file should NOT be deleted (it's in exportsPath)
      expect(require.cache[interfaceFilePath]).to.exist;

      // Cleanup
      delete require.cache[interfaceFilePath];
    });

    it('should not delete files from nested modules', () => {
      // Set up parent and nested modules
      const parentModule = {
        ref: {
          manifest: {
            folder: '/test/parent',
            exportsPath: '/test/parent/interfaces',
          },
        },
        config: {},
      };

      const nestedModule = {
        ref: {
          manifest: {
            folder: '/test/parent/nested',
            exportsPath: '/test/parent/nested/interfaces',
          },
        },
        config: {},
      };

      manager.loadedModules.set('parent', parentModule);
      manager.loadedModules.set('nested', nestedModule);

      // Add entries to require.cache
      const parentFile = '/test/parent/src/index.js';
      const nestedFile = '/test/parent/nested/src/index.js';
      require.cache[parentFile] = {} as any;
      require.cache[nestedFile] = {} as any;

      manager.unrequireModuleFiles(parentModule);

      // Parent file should be deleted
      expect(require.cache[parentFile]).to.be.undefined;
      // Nested module file should NOT be deleted
      expect(require.cache[nestedFile]).to.exist;

      // Cleanup
      delete require.cache[nestedFile];
    });
  });
});
