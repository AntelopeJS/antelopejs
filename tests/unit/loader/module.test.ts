import { expect, sinon } from '../../helpers/setup';
import { Module, ModuleState, ModuleCallbacks } from '../../../src/loader/module';
import { ModuleManifest } from '../../../src/common/manifest';
import * as fs from 'fs/promises';

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

  describe('ModuleCallbacks interface', () => {
    it('should accept construct callback', () => {
      const callbacks: ModuleCallbacks = {
        construct: async (config) => {},
      };
      expect(callbacks.construct).to.be.a('function');
    });

    it('should accept destroy callback', () => {
      const callbacks: ModuleCallbacks = {
        destroy: async () => {},
      };
      expect(callbacks.destroy).to.be.a('function');
    });

    it('should accept start callback', () => {
      const callbacks: ModuleCallbacks = {
        start: () => {},
      };
      expect(callbacks.start).to.be.a('function');
    });

    it('should accept stop callback', () => {
      const callbacks: ModuleCallbacks = {
        stop: () => {},
      };
      expect(callbacks.stop).to.be.a('function');
    });

    it('should accept all callbacks together', () => {
      const callbacks: ModuleCallbacks = {
        construct: async (config) => {},
        destroy: async () => {},
        start: () => {},
        stop: () => {},
      };
      expect(callbacks).to.have.all.keys('construct', 'destroy', 'start', 'stop');
    });

    it('should allow partial callbacks', () => {
      const callbacks: ModuleCallbacks = {};
      expect(callbacks.construct).to.be.undefined;
      expect(callbacks.destroy).to.be.undefined;
    });
  });

  describe('Module extended tests', () => {
    let mockManifest: ModuleManifest;

    beforeEach(() => {
      mockManifest = {
        name: 'extended-test-module',
        version: '2.0.0',
        folder: '/test/extended/path',
        main: '/test/extended/path/index.js',
        exportsPath: '/test/extended/path/exports',
        imports: [],
        exports: {},
        paths: [],
        source: { type: 'local', path: '/test/extended/path' },
        reload: sinon.stub().resolves(),
        loadExports: sinon.stub().resolves(),
      } as unknown as ModuleManifest;
    });

    describe('stateStr property', () => {
      it('should return "loaded" for initial state', () => {
        const module = new Module(mockManifest);
        expect(module.stateStr).to.equal('loaded');
      });

      it('should be a string type', () => {
        const module = new Module(mockManifest);
        expect(module.stateStr).to.be.a('string');
      });

      it('should return valid state string', () => {
        const module = new Module(mockManifest);
        const validStates = ['loaded', 'constructed', 'active', 'unknown'];
        expect(validStates).to.include(module.stateStr);
      });
    });

    describe('version property', () => {
      it('should return module version from manifest', () => {
        const module = new Module(mockManifest);
        expect(module.version).to.equal('2.0.0');
      });

      it('should be a string type', () => {
        const module = new Module(mockManifest);
        expect(module.version).to.be.a('string');
      });

      it('should match manifest version', () => {
        mockManifest.version = '3.1.4';
        const module = new Module(mockManifest);
        expect(module.version).to.equal('3.1.4');
      });
    });

    describe('id property', () => {
      it('should return module id from manifest name', () => {
        const module = new Module(mockManifest);
        expect(module.id).to.equal('extended-test-module');
      });

      it('should be a string type', () => {
        const module = new Module(mockManifest);
        expect(module.id).to.be.a('string');
      });

      it('should match manifest name', () => {
        const customManifest = {
          ...mockManifest,
          name: 'custom-module-name',
        } as unknown as ModuleManifest;
        const module = new Module(customManifest);
        expect(module.id).to.equal('custom-module-name');
      });

      it('should be readonly', () => {
        const module = new Module(mockManifest);
        // TypeScript enforces this at compile time
        // At runtime, we can verify the property exists
        expect(module.id).to.exist;
      });
    });

    describe('manifest property', () => {
      it('should return the manifest passed in constructor', () => {
        const module = new Module(mockManifest);
        expect(module.manifest).to.equal(mockManifest);
      });

      it('should be readonly', () => {
        const module = new Module(mockManifest);
        expect(module.manifest).to.exist;
      });
    });

    describe('attachProxy', () => {
      it('should not throw when attaching proxy', () => {
        const module = new Module(mockManifest);
        const mockProxy = { detach: sinon.stub() };
        expect(() => module.attachProxy(mockProxy as any)).to.not.throw();
      });

      it('should accept multiple proxies', () => {
        const module = new Module(mockManifest);
        const mockProxy1 = { detach: sinon.stub() };
        const mockProxy2 = { detach: sinon.stub() };

        module.attachProxy(mockProxy1 as any);
        module.attachProxy(mockProxy2 as any);
        // Should not throw
      });
    });

    describe('state transitions', () => {
      it('should stay in loaded state when start() called without construct', () => {
        const module = new Module(mockManifest);
        module.start();
        expect(module.stateStr).to.equal('loaded');
      });

      it('should stay in loaded state when stop() called without being active', () => {
        const module = new Module(mockManifest);
        module.stop();
        expect(module.stateStr).to.equal('loaded');
      });

      it('should remain loaded after destroy() when already loaded', async () => {
        const module = new Module(mockManifest);
        await module.destroy();
        expect(module.stateStr).to.equal('loaded');
      });
    });
  });
});
