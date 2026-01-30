import { expect, sinon } from '../../helpers/setup';
import { Module, ModuleState } from '../../../src/loader/module';
import { ModuleManifest } from '../../../src/common/manifest';

describe('loader/module', () => {
  describe('ModuleState', () => {
    it('should have loaded state', () => {
      expect(ModuleState.loaded).to.equal(0);
    });

    it('should have constructed state', () => {
      expect(ModuleState.constructed).to.equal(1);
    });

    it('should have active state', () => {
      expect(ModuleState.active).to.equal(2);
    });
  });

  describe('Module', () => {
    let mockManifest: ModuleManifest;

    beforeEach(() => {
      // Create a minimal mock manifest
      mockManifest = {
        name: 'test-module',
        version: '1.0.0',
        folder: '/test/path',
        main: '/test/path/index.js',
        exportsPath: '/test/path/exports',
        imports: [],
        exports: {},
        paths: [],
        source: { type: 'local', path: '/test/path' },
        reload: sinon.stub().resolves(),
        loadExports: sinon.stub().resolves(),
      } as unknown as ModuleManifest;
    });

    describe('constructor', () => {
      it('should create a module with manifest', () => {
        const module = new Module(mockManifest);

        expect(module.id).to.equal('test-module');
        expect(module.version).to.equal('1.0.0');
        expect(module.manifest).to.equal(mockManifest);
      });

      it('should initialize in loaded state', () => {
        const module = new Module(mockManifest);

        expect(module.stateStr).to.equal('loaded');
      });
    });

    describe('stateStr', () => {
      it('should return loaded for initial state', () => {
        const module = new Module(mockManifest);
        expect(module.stateStr).to.equal('loaded');
      });
    });

    describe('attachProxy', () => {
      it('should attach proxy to module', () => {
        const module = new Module(mockManifest);
        const mockProxy = { detach: sinon.stub() };

        module.attachProxy(mockProxy as any);
        // Proxy should be stored internally
      });
    });

    describe('start', () => {
      it('should not start if not constructed', () => {
        const module = new Module(mockManifest);
        module.start();
        expect(module.stateStr).to.equal('loaded');
      });
    });

    describe('stop', () => {
      it('should not stop if not active', () => {
        const module = new Module(mockManifest);
        module.stop();
        expect(module.stateStr).to.equal('loaded');
      });
    });

    describe('destroy', () => {
      it('should not destroy if already in loaded state', async () => {
        const module = new Module(mockManifest);
        await module.destroy();
        expect(module.stateStr).to.equal('loaded');
      });
    });

    // Note: Tests for construct/start/stop/destroy with real transitions
    // are limited because they require actual module files to be loaded.
    // These are tested through integration tests with real modules.
  });

});
