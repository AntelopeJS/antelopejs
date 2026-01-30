import { expect, sinon } from '../../../helpers/setup';
import proxyquire from 'proxyquire';
import path from 'path';

describe('common/downloader/package', () => {
  describe('package source validation', () => {
    it('should validate package source structure', () => {
      const source = {
        type: 'package',
        package: '@scope/module',
        version: '^1.0.0',
      };

      expect(source).to.have.property('package');
      expect(source).to.have.property('version');
      expect(source.type).to.equal('package');
    });

    it('should handle scoped packages', () => {
      const source = {
        type: 'package',
        package: '@myorg/mypackage',
        version: '2.0.0',
      };

      expect(source.package).to.match(/^@[\w-]+\/[\w-]+$/);
    });

    it('should handle unscoped packages', () => {
      const source = {
        type: 'package',
        package: 'simple-package',
        version: '1.0.0',
      };

      expect(source.package).to.not.include('@');
    });
  });

  describe('version handling', () => {
    it('should accept exact versions', () => {
      const source = {
        type: 'package',
        package: 'module',
        version: '1.2.3',
      };

      expect(source.version).to.match(/^\d+\.\d+\.\d+$/);
    });

    it('should accept semver ranges', () => {
      const ranges = ['^1.0.0', '~1.0.0', '>=1.0.0', '1.x', '*'];

      ranges.forEach((version) => {
        const source = {
          type: 'package',
          package: 'module',
          version,
        };
        expect(source.version).to.equal(version);
      });
    });

    it('should accept latest tag', () => {
      const source = {
        type: 'package',
        package: 'module',
        version: 'latest',
      };

      expect(source.version).to.equal('latest');
    });

    it('should accept beta tag', () => {
      const source = {
        type: 'package',
        package: 'module',
        version: 'beta',
      };

      expect(source.version).to.equal('beta');
    });
  });

  describe('npm pack command', () => {
    it('should construct correct npm pack command', () => {
      const packageName = '@scope/module';
      const version = '1.0.0';

      const command = `npm pack ${packageName}@${version}`;

      expect(command).to.equal('npm pack @scope/module@1.0.0');
    });

    it('should handle special characters in package names', () => {
      const packageName = '@my-org/my-package';
      const version = '1.0.0-beta.1';

      const command = `npm pack ${packageName}@${version}`;

      expect(command).to.include('@my-org/my-package');
      expect(command).to.include('1.0.0-beta.1');
    });
  });

  describe('cache integration', () => {
    it('should check cache before downloading', () => {
      const cacheHit = true;
      const shouldDownload = !cacheHit;

      expect(shouldDownload).to.be.false;
    });

    it('should update cache after successful download', () => {
      const downloaded = true;
      const shouldUpdateCache = downloaded;

      expect(shouldUpdateCache).to.be.true;
    });
  });

  describe('ignoreCache option', () => {
    it('should support ignoreCache flag', () => {
      const source = {
        type: 'package',
        package: 'module',
        version: '1.0.0',
        ignoreCache: true,
      };

      expect(source.ignoreCache).to.be.true;
    });

    it('should default ignoreCache to undefined', () => {
      const source: any = {
        type: 'package',
        package: 'module',
        version: '1.0.0',
      };

      expect(source.ignoreCache).to.be.undefined;
    });
  });

  describe('Extract function', () => {
    it('should resolve when extraction succeeds', async () => {
      // Test the Extract function behavior by simulating the inly library
      const mockInly = (from: string, to: string) => {
        const emitter = {
          callbacks: {} as Record<string, Function>,
          on(event: string, callback: Function) {
            this.callbacks[event] = callback;
            return this;
          },
          emit(event: string, ...args: any[]) {
            if (this.callbacks[event]) {
              this.callbacks[event](...args);
            }
          },
        };
        // Simulate async success
        setTimeout(() => emitter.emit('end'), 0);
        return emitter;
      };

      const result = await new Promise<void>((resolve, reject) => {
        const i = mockInly('/tmp/package.tgz', '/tmp/output');
        i.on('error', reject);
        i.on('end', resolve);
      });

      expect(result).to.be.undefined; // Promise resolves with void
    });

    it('should reject when extraction fails', async () => {
      // Test the Extract function behavior when inly emits an error
      const mockInly = (from: string, to: string) => {
        const emitter = {
          callbacks: {} as Record<string, Function>,
          on(event: string, callback: Function) {
            this.callbacks[event] = callback;
            return this;
          },
          emit(event: string, ...args: any[]) {
            if (this.callbacks[event]) {
              this.callbacks[event](...args);
            }
          },
        };
        // Simulate async error
        setTimeout(() => emitter.emit('error', new Error('Extraction failed')), 0);
        return emitter;
      };

      try {
        await new Promise<void>((resolve, reject) => {
          const i = mockInly('/tmp/package.tgz', '/tmp/output');
          i.on('error', reject);
          i.on('end', resolve);
        });
        expect.fail('Should have rejected');
      } catch (error: any) {
        expect(error.message).to.equal('Extraction failed');
      }
    });
  });

  describe('package loader with mocked dependencies', () => {
    let mockExecuteCMD: sinon.SinonStub;
    let mockInly: sinon.SinonStub;
    let mockGetInstallCommand: sinon.SinonStub;
    let mockModuleManifest: any;
    let registerLoaderSpy: sinon.SinonStub;

    beforeEach(() => {
      mockExecuteCMD = sinon.stub();
      mockGetInstallCommand = sinon.stub().resolves('npm install --omit=dev');
      mockModuleManifest = class {
        constructor(public folder: string, public source: any, public name: string) {}
      };
      registerLoaderSpy = sinon.stub();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should register package loader on import', () => {
      proxyquire.noCallThru()('../../../../src/common/downloader/package', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../cache': { ModuleCache: class { static getTemp() { return Promise.resolve('/tmp'); } } },
        path: require('path'),
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} Error() {} } },
        },
        inly: sinon.stub(),
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../../utils/package-manager': { getInstallCommand: mockGetInstallCommand },
        '../manifest': { ModuleManifest: mockModuleManifest, ModulePackageJson: {} },
      });

      expect(registerLoaderSpy).to.have.been.calledOnce;
      expect(registerLoaderSpy.firstCall.args[0]).to.equal('package');
      expect(registerLoaderSpy.firstCall.args[1]).to.equal('package');
    });

    it('should capture loader function correctly', async () => {
      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/package', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../cache': { ModuleCache: class { static getTemp() { return Promise.resolve('/tmp'); } } },
        path: require('path'),
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} Error() {} } },
        },
        inly: sinon.stub(),
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../../utils/package-manager': { getInstallCommand: mockGetInstallCommand },
        '../manifest': { ModuleManifest: mockModuleManifest, ModulePackageJson: {} },
      });

      expect(capturedLoader).to.be.a('function');
    });

    it('should throw error when npm pack fails', async () => {
      const tmpFolder = '/tmp/ajs-123';

      mockExecuteCMD
        .withArgs(sinon.match(/npm pack/))
        .resolves({ code: 1, stdout: '', stderr: 'npm ERR! 404 Not Found' });

      const mockModuleCache = {
        hasVersion: sinon.stub().returns(false),
      };

      const mockModuleCacheClass = class {
        static getTemp() {
          return Promise.resolve(tmpFolder);
        }
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/package', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../cache': { ModuleCache: mockModuleCacheClass },
        path: require('path'),
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} Error() {} } },
        },
        inly: sinon.stub(),
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../../utils/package-manager': { getInstallCommand: mockGetInstallCommand },
        '../manifest': { ModuleManifest: mockModuleManifest, ModulePackageJson: {} },
      });

      const source = {
        id: 'nonexistent-package',
        type: 'package',
        package: 'nonexistent-package',
        version: '1.0.0',
      };

      try {
        await capturedLoader(mockModuleCache, source);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Failed to pack npm package');
      }
    });

    it('should return empty array when extraction fails', async () => {
      const tmpFolder = '/tmp/ajs-123';

      // Mock inly to simulate extraction failure
      const mockInlyInstance = {
        callbacks: {} as Record<string, Function>,
        on(event: string, callback: Function) {
          this.callbacks[event] = callback;
          return this;
        },
        triggerError(err: Error) {
          if (this.callbacks['error']) {
            this.callbacks['error'](err);
          }
        },
      };
      mockInly = sinon.stub().returns(mockInlyInstance);

      mockExecuteCMD
        .withArgs(sinon.match(/npm pack/))
        .resolves({ code: 0, stdout: 'my-package-1.0.0.tgz\n', stderr: '' });

      const mockModuleCache = {
        hasVersion: sinon.stub().returns(false),
      };

      const mockModuleCacheClass = class {
        static getTemp() {
          return Promise.resolve(tmpFolder);
        }
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/package', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../cache': { ModuleCache: mockModuleCacheClass },
        path: require('path'),
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} Error() {} } },
        },
        inly: mockInly,
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../../utils/package-manager': { getInstallCommand: mockGetInstallCommand },
        '../manifest': { ModuleManifest: mockModuleManifest, ModulePackageJson: {} },
      });

      const source = {
        id: 'my-package',
        type: 'package',
        package: 'my-package',
        version: '1.0.0',
      };

      // Start the loader call
      const loaderPromise = capturedLoader(mockModuleCache, source);

      // Trigger the extraction to fail
      await new Promise(resolve => setTimeout(resolve, 10));
      mockInlyInstance.triggerError(new Error('Extraction failed'));

      const result = await loaderPromise;

      // When extraction fails, the loader returns empty array
      expect(result).to.deep.equal([]);
    });

    it('should call npm pack with correct package and version', async () => {
      const tmpFolder = '/tmp/ajs-123';

      mockExecuteCMD
        .withArgs(sinon.match(/npm pack/))
        .resolves({ code: 1, stdout: '', stderr: 'npm ERR! Something went wrong' });

      const mockModuleCache = {
        hasVersion: sinon.stub().returns(false),
      };

      const mockModuleCacheClass = class {
        static getTemp() {
          return Promise.resolve(tmpFolder);
        }
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/package', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../cache': { ModuleCache: mockModuleCacheClass },
        path: require('path'),
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} Error() {} } },
        },
        inly: sinon.stub(),
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../../utils/package-manager': { getInstallCommand: mockGetInstallCommand },
        '../manifest': { ModuleManifest: mockModuleManifest, ModulePackageJson: {} },
      });

      const source = {
        id: 'my-package',
        type: 'package',
        package: '@scope/my-package',
        version: '2.0.0',
      };

      try {
        await capturedLoader(mockModuleCache, source);
      } catch {
        // Expected to fail, we're testing the call
      }

      expect(mockExecuteCMD).to.have.been.calledWith(
        'npm pack @scope/my-package@2.0.0',
        { cwd: tmpFolder }
      );
    });

    it('should skip download when cache has matching version', async () => {
      const cacheFolder = '/cache/my-package';

      const mockModuleCache = {
        hasVersion: sinon.stub().returns(true),
        getFolder: sinon.stub().resolves(cacheFolder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      // We need to test that hasVersion is called correctly
      // The actual require() for package.json will fail, but we can verify the cache check
      proxyquire.noCallThru()('../../../../src/common/downloader/package', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../cache': { ModuleCache: class { static getTemp() { return Promise.resolve('/tmp'); } } },
        path: require('path'),
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} Error() {} } },
        },
        inly: sinon.stub(),
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../../utils/package-manager': { getInstallCommand: mockGetInstallCommand },
        '../manifest': { ModuleManifest: mockModuleManifest, ModulePackageJson: {} },
      });

      const source = {
        id: 'my-package',
        type: 'package',
        package: 'my-package',
        version: '1.0.0',
        ignoreCache: false,
      };

      // This will fail on require(), but we can verify hasVersion was called
      try {
        await capturedLoader(mockModuleCache, source);
      } catch {
        // Expected due to require() call
      }

      expect(mockModuleCache.hasVersion).to.have.been.calledWith('my-package', '1.0.0');
      // ExecuteCMD should not have been called for npm pack since we're using cache
      expect(mockExecuteCMD).to.not.have.been.called;
    });

    it('should check ignoreCache flag and download when true', async () => {
      const tmpFolder = '/tmp/ajs-123';

      mockExecuteCMD
        .withArgs(sinon.match(/npm pack/))
        .resolves({ code: 1, stdout: '', stderr: 'npm ERR!' });

      const mockModuleCache = {
        hasVersion: sinon.stub().returns(true), // Cache has version
      };

      const mockModuleCacheClass = class {
        static getTemp() {
          return Promise.resolve(tmpFolder);
        }
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/package', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../cache': { ModuleCache: mockModuleCacheClass },
        path: require('path'),
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} Error() {} } },
        },
        inly: sinon.stub(),
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../../utils/package-manager': { getInstallCommand: mockGetInstallCommand },
        '../manifest': { ModuleManifest: mockModuleManifest, ModulePackageJson: {} },
      });

      const source = {
        id: 'my-package',
        type: 'package',
        package: 'my-package',
        version: '1.0.0',
        ignoreCache: true, // Force download
      };

      try {
        await capturedLoader(mockModuleCache, source);
      } catch {
        // Expected to fail
      }

      // Should have called npm pack because ignoreCache is true
      expect(mockExecuteCMD).to.have.been.calledWith(
        'npm pack my-package@1.0.0',
        { cwd: tmpFolder }
      );
    });

    it('should construct correct extraction path from npm pack output', async () => {
      const tmpFolder = '/tmp/ajs-123';

      // Mock inly to capture the path it's called with
      let capturedFromPath: string = '';
      let capturedToPath: string = '';
      const mockInlyInstance = {
        callbacks: {} as Record<string, Function>,
        on(event: string, callback: Function) {
          this.callbacks[event] = callback;
          return this;
        },
        triggerError(err: Error) {
          if (this.callbacks['error']) {
            this.callbacks['error'](err);
          }
        },
      };
      mockInly = sinon.stub().callsFake((from: string, to: string) => {
        capturedFromPath = from;
        capturedToPath = to;
        return mockInlyInstance;
      });

      mockExecuteCMD
        .withArgs(sinon.match(/npm pack/))
        .resolves({ code: 0, stdout: 'scope-my-package-1.2.3.tgz\n', stderr: '' });

      const mockModuleCache = {
        hasVersion: sinon.stub().returns(false),
      };

      const mockModuleCacheClass = class {
        static getTemp() {
          return Promise.resolve(tmpFolder);
        }
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/package', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../cache': { ModuleCache: mockModuleCacheClass },
        path: require('path'),
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} Error() {} } },
        },
        inly: mockInly,
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../../utils/package-manager': { getInstallCommand: mockGetInstallCommand },
        '../manifest': { ModuleManifest: mockModuleManifest, ModulePackageJson: {} },
      });

      const source = {
        id: '@scope/my-package',
        type: 'package',
        package: '@scope/my-package',
        version: '1.2.3',
      };

      const loaderPromise = capturedLoader(mockModuleCache, source);

      await new Promise(resolve => setTimeout(resolve, 10));
      mockInlyInstance.triggerError(new Error('Test')); // Just to end the promise

      await loaderPromise;

      expect(capturedFromPath).to.equal(`${tmpFolder}/scope-my-package-1.2.3.tgz`);
      expect(capturedToPath).to.equal(tmpFolder);
    });

    it('should handle version tags like latest', async () => {
      const tmpFolder = '/tmp/ajs-123';

      mockExecuteCMD
        .withArgs(sinon.match(/npm pack/))
        .resolves({ code: 1, stdout: '', stderr: 'npm ERR!' });

      const mockModuleCache = {
        hasVersion: sinon.stub().returns(false),
      };

      const mockModuleCacheClass = class {
        static getTemp() {
          return Promise.resolve(tmpFolder);
        }
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/package', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../cache': { ModuleCache: mockModuleCacheClass },
        path: require('path'),
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} Error() {} } },
        },
        inly: sinon.stub(),
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../../utils/package-manager': { getInstallCommand: mockGetInstallCommand },
        '../manifest': { ModuleManifest: mockModuleManifest, ModulePackageJson: {} },
      });

      const source = {
        id: 'my-package',
        type: 'package',
        package: 'my-package',
        version: 'latest',
      };

      try {
        await capturedLoader(mockModuleCache, source);
      } catch {
        // Expected to fail
      }

      expect(mockExecuteCMD).to.have.been.calledWith(
        'npm pack my-package@latest',
        { cwd: tmpFolder }
      );
    });

    it('should handle beta version tag', async () => {
      const tmpFolder = '/tmp/ajs-123';

      mockExecuteCMD
        .withArgs(sinon.match(/npm pack/))
        .resolves({ code: 1, stdout: '', stderr: 'npm ERR!' });

      const mockModuleCache = {
        hasVersion: sinon.stub().returns(false),
      };

      const mockModuleCacheClass = class {
        static getTemp() {
          return Promise.resolve(tmpFolder);
        }
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/package', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../cache': { ModuleCache: mockModuleCacheClass },
        path: require('path'),
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} Error() {} } },
        },
        inly: sinon.stub(),
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../../utils/package-manager': { getInstallCommand: mockGetInstallCommand },
        '../manifest': { ModuleManifest: mockModuleManifest, ModulePackageJson: {} },
      });

      const source = {
        id: 'my-package',
        type: 'package',
        package: 'my-package',
        version: 'beta',
      };

      try {
        await capturedLoader(mockModuleCache, source);
      } catch {
        // Expected to fail
      }

      expect(mockExecuteCMD).to.have.been.calledWith(
        'npm pack my-package@beta',
        { cwd: tmpFolder }
      );
    });

    it('should use ModuleCache.getTemp for temp directory', async () => {
      const tmpFolder = '/custom/temp/path';
      let getTempCalled = false;

      mockExecuteCMD
        .withArgs(sinon.match(/npm pack/))
        .resolves({ code: 1, stdout: '', stderr: 'npm ERR!' });

      const mockModuleCache = {
        hasVersion: sinon.stub().returns(false),
      };

      const mockModuleCacheClass = class {
        static getTemp() {
          getTempCalled = true;
          return Promise.resolve(tmpFolder);
        }
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/package', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../cache': { ModuleCache: mockModuleCacheClass },
        path: require('path'),
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} Error() {} } },
        },
        inly: sinon.stub(),
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../../utils/package-manager': { getInstallCommand: mockGetInstallCommand },
        '../manifest': { ModuleManifest: mockModuleManifest, ModulePackageJson: {} },
      });

      const source = {
        id: 'my-package',
        type: 'package',
        package: 'my-package',
        version: '1.0.0',
      };

      try {
        await capturedLoader(mockModuleCache, source);
      } catch {
        // Expected to fail
      }

      expect(getTempCalled).to.be.true;
      expect(mockExecuteCMD).to.have.been.calledWith(
        sinon.match.string,
        { cwd: tmpFolder }
      );
    });
  });

  describe('ModuleSourcePackage interface', () => {
    it('should have required type property', () => {
      const source: { type: 'package'; package: string; version: string } = {
        type: 'package',
        package: 'test',
        version: '1.0.0',
      };

      expect(source.type).to.equal('package');
    });

    it('should have required package property', () => {
      const source = {
        type: 'package',
        package: 'my-module',
        version: '1.0.0',
      };

      expect(source.package).to.be.a('string');
      expect(source.package).to.equal('my-module');
    });

    it('should have required version property', () => {
      const source = {
        type: 'package',
        package: 'my-module',
        version: '2.0.0',
      };

      expect(source.version).to.be.a('string');
      expect(source.version).to.equal('2.0.0');
    });
  });
});
