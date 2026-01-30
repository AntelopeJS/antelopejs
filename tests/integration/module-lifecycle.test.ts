import { expect, sinon } from '../helpers/setup';
import * as fs from 'fs';
import * as path from 'path';
import { Module, ModuleState } from '../../src/loader/module';
import { ModuleManifest } from '../../src/common/manifest';

describe('Integration: Module Lifecycle', () => {
  const testDir = path.join(__dirname, '../fixtures/test-module-lifecycle-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Module state transitions', () => {
    let mockManifest: ModuleManifest;

    beforeEach(() => {
      mockManifest = {
        name: 'test-module',
        version: '1.0.0',
        folder: '/test/module',
        main: '/test/module/index.js',
        exportsPath: '/test/module/exports',
        imports: [],
        exports: {},
        paths: [],
        source: { type: 'local', path: '/test/module' },
        reload: sinon.stub().resolves(),
        loadExports: sinon.stub().resolves(),
      } as unknown as ModuleManifest;
    });

    it('should start in loaded state', () => {
      const module = new Module(mockManifest);
      expect(module.stateStr).to.equal('loaded');
    });

    it('should track module id and version', () => {
      const module = new Module(mockManifest);
      expect(module.id).to.equal('test-module');
      expect(module.version).to.equal('1.0.0');
    });

    it('should not start without construct', () => {
      const module = new Module(mockManifest);
      module.start();
      expect(module.stateStr).to.equal('loaded');
    });

    it('should not stop without being active', () => {
      const module = new Module(mockManifest);
      module.stop();
      expect(module.stateStr).to.equal('loaded');
    });
  });

  // Note: ModuleManager lifecycle tests are limited because ModuleManager.shutdown()
  // corrupts the Node.js module system (ModuleResolverDetour.detach() sets
  // Module._resolveFilename to undefined if attach() was never called).
  // Full ModuleManager testing requires a separate process or more sophisticated mocking.

  describe('Module proxy attachment', () => {
    let mockManifest: ModuleManifest;

    beforeEach(() => {
      mockManifest = {
        name: 'proxy-test-module',
        version: '1.0.0',
        folder: '/test/proxy-module',
        main: '/test/proxy-module/index.js',
        exportsPath: '/test/proxy-module/exports',
        imports: [],
        exports: {},
        paths: [],
        source: { type: 'local', path: '/test/proxy-module' },
        reload: sinon.stub().resolves(),
        loadExports: sinon.stub().resolves(),
      } as unknown as ModuleManifest;
    });

    it('should attach proxy to module', () => {
      const module = new Module(mockManifest);
      const mockProxy = { detach: sinon.stub() };

      module.attachProxy(mockProxy as any);
      // Should not throw
    });
  });
});
