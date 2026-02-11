import { expect } from 'chai';
import sinon from 'sinon';
import { ConfigLoader } from '../../../src/core/config/config-loader';
import { InMemoryFileSystem } from '../../helpers/in-memory-filesystem';
import * as testModule from '../../../src/core/test/test-module';

describe('test-module', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('loadTestConfig', () => {
    it('returns undefined when package.json is missing', async () => {
      const fs = new InMemoryFileSystem();
      const consoleStub = sinon.stub(console, 'error');

      const result = await testModule.loadTestConfig('/module', fs);

      expect(result).to.equal(undefined);
      expect(consoleStub.calledWith('Missing or invalid package.json')).to.equal(true);
    });

    it('returns undefined when antelopeJs.test is missing', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/module/package.json', JSON.stringify({ name: 'test' }));
      const consoleStub = sinon.stub(console, 'error');

      const result = await testModule.loadTestConfig('/module', fs);

      expect(result).to.equal(undefined);
      expect(consoleStub.calledWith('Missing or invalid antelopeJs.test config path in package.json')).to.equal(true);
    });

    it('returns undefined when antelopeJs.test is not a string', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        '/module/package.json',
        JSON.stringify({
          antelopeJs: { test: { project: './test.ts' } },
        }),
      );
      const consoleStub = sinon.stub(console, 'error');

      const result = await testModule.loadTestConfig('/module', fs);

      expect(result).to.equal(undefined);
      expect(consoleStub.calledWith('Missing or invalid antelopeJs.test config path in package.json')).to.equal(true);
    });

    it('loads config from valid test config path', async () => {
      const fs = new InMemoryFileSystem();
      const setupFn = async () => {};
      await fs.writeFile(
        '/module/package.json',
        JSON.stringify({
          antelopeJs: { test: './antelope.test.config.ts' },
        }),
      );

      const mockConfig = {
        name: 'test-project',
        cacheFolder: '.antelope/cache',
        modules: {},
        envOverrides: {},
        test: { folder: 'specs', setup: setupFn },
      };
      sinon.stub(ConfigLoader.prototype, 'load').resolves(mockConfig as any);

      const result = await testModule.loadTestConfig('/module', fs);

      expect(result).to.not.equal(undefined);
      expect(result!.config).to.equal(mockConfig);
      expect(result!.test.folder).to.equal('specs');
      expect(result!.test.setup).to.equal(setupFn);
    });

    it('defaults test to empty object when config has no test section', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        '/module/package.json',
        JSON.stringify({
          antelopeJs: { test: './config.ts' },
        }),
      );

      sinon.stub(ConfigLoader.prototype, 'load').resolves({
        name: 'test-project',
        cacheFolder: '.antelope/cache',
        modules: {},
        envOverrides: {},
      } as any);

      const result = await testModule.loadTestConfig('/module', fs);

      expect(result).to.not.equal(undefined);
      expect(result!.test).to.deep.equal({});
    });

    it('returns undefined when config loading fails', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        '/module/package.json',
        JSON.stringify({
          antelopeJs: { test: './missing-config.ts' },
        }),
      );

      sinon.stub(ConfigLoader.prototype, 'load').rejects(new Error('Config not found'));
      const consoleStub = sinon.stub(console, 'error');

      const result = await testModule.loadTestConfig('/module', fs);

      expect(result).to.equal(undefined);
      expect(consoleStub.called).to.equal(true);
    });

    it('resolves relative config path against module root', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        '/module/package.json',
        JSON.stringify({
          antelopeJs: { test: './antelope.test.config.ts' },
        }),
      );

      const loadStub = sinon.stub(ConfigLoader.prototype, 'load').resolves({
        name: 'test',
        cacheFolder: '.antelope/cache',
        modules: {},
        envOverrides: {},
      } as any);

      await testModule.loadTestConfig('/module', fs);

      expect(loadStub.firstCall.args[2]).to.equal('/module/antelope.test.config.ts');
    });
  });

  describe('TestModule', () => {
    it('returns EXIT_CODE_ERROR when config loading fails', async () => {
      sinon.stub(testModule, 'loadTestConfig').resolves(undefined);

      const result = await testModule.TestModule('/module');

      expect(result).to.equal(1);
    });

    it('calls setup before loading modules and cleanup in finally', async () => {
      const callOrder: string[] = [];
      const setupFn = sinon.stub().callsFake(async () => {
        callOrder.push('setup');
      });
      const cleanupFn = sinon.stub().callsFake(async () => {
        callOrder.push('cleanup');
      });
      const destroyAllStub = sinon.stub().callsFake(async () => {
        callOrder.push('destroy');
      });

      const mockConfig = {
        name: 'test',
        cacheFolder: '.antelope/cache',
        modules: {},
        envOverrides: {},
        test: { setup: setupFn, cleanup: cleanupFn },
      };

      sinon.stub(testModule, 'loadTestConfig').resolves({
        config: mockConfig as any,
        test: mockConfig.test,
      });

      sinon.stub(testModule, 'setupTestEnvironment').callsFake(async () => {
        callOrder.push('setupEnv');
        return { destroyAll: destroyAllStub } as any;
      });

      sinon.stub(testModule, 'executeTests').callsFake(async () => {
        callOrder.push('runTests');
        return 0;
      });

      await testModule.TestModule('/module');

      expect(callOrder).to.deep.equal(['setup', 'setupEnv', 'runTests', 'destroy', 'cleanup']);
    });

    it('calls cleanup even when test execution throws', async () => {
      const cleanupFn = sinon.stub().resolves();
      const destroyAllStub = sinon.stub().resolves();

      const mockConfig = {
        name: 'test',
        cacheFolder: '.antelope/cache',
        modules: {},
        envOverrides: {},
        test: { cleanup: cleanupFn },
      };

      sinon.stub(testModule, 'loadTestConfig').resolves({
        config: mockConfig as any,
        test: mockConfig.test,
      });

      sinon.stub(testModule, 'setupTestEnvironment').resolves({
        destroyAll: destroyAllStub,
      } as any);

      sinon.stub(testModule, 'executeTests').rejects(new Error('test crash'));
      let hasThrown = false;

      try {
        await testModule.TestModule('/module');
      } catch {
        hasThrown = true;
      }

      expect(hasThrown).to.equal(true);
      expect(cleanupFn.calledOnce).to.equal(true);
    });

    it('merges setup overrides into config before loading modules', async () => {
      const setupOverrides = {
        modules: { 'my-db': { config: { connectionUrl: 'sqlite://memory' } } },
      };
      const setupFn = sinon.stub().resolves(setupOverrides);
      const destroyAllStub = sinon.stub().resolves();

      const mockConfig = {
        name: 'test',
        cacheFolder: '.antelope/cache',
        modules: {
          'my-db': {
            source: { type: 'local', path: '.' },
            config: { host: 'localhost' },
            importOverrides: [],
            disabledExports: [],
          },
        },
        envOverrides: {},
        test: { setup: setupFn },
      };

      sinon.stub(testModule, 'loadTestConfig').resolves({
        config: mockConfig as any,
        test: mockConfig.test,
      });

      const setupEnvStub = sinon.stub(testModule, 'setupTestEnvironment').resolves({
        destroyAll: destroyAllStub,
      } as any);

      sinon.stub(testModule, 'executeTests').resolves(0);

      await testModule.TestModule('/module');

      expect(setupFn.calledOnce).to.equal(true);
      const configPassedToSetup = setupEnvStub.firstCall.args[1];
      expect(configPassedToSetup.modules['my-db'].config).to.deep.equal({
        host: 'localhost',
        connectionUrl: 'sqlite://memory',
      });
    });

    it('does not modify config when setup returns void', async () => {
      const setupFn = sinon.stub().resolves(undefined);
      const destroyAllStub = sinon.stub().resolves();

      const originalConfig = {
        name: 'test',
        cacheFolder: '.antelope/cache',
        modules: {
          'my-mod': {
            source: { type: 'local', path: '.' },
            config: { key: 'val' },
            importOverrides: [],
            disabledExports: [],
          },
        },
        envOverrides: {},
        test: { setup: setupFn },
      };

      sinon.stub(testModule, 'loadTestConfig').resolves({
        config: originalConfig as any,
        test: originalConfig.test,
      });

      const setupEnvStub = sinon.stub(testModule, 'setupTestEnvironment').resolves({
        destroyAll: destroyAllStub,
      } as any);

      sinon.stub(testModule, 'executeTests').resolves(0);

      await testModule.TestModule('/module');

      const configPassed = setupEnvStub.firstCall.args[1];
      expect(configPassed.modules['my-mod'].config).to.deep.equal({ key: 'val' });
    });

    it('works without setup and cleanup hooks', async () => {
      const destroyAllStub = sinon.stub().resolves();

      const mockConfig = {
        name: 'test',
        cacheFolder: '.antelope/cache',
        modules: {},
        envOverrides: {},
        test: {},
      };

      sinon.stub(testModule, 'loadTestConfig').resolves({
        config: mockConfig as any,
        test: mockConfig.test,
      });

      sinon.stub(testModule, 'setupTestEnvironment').resolves({
        destroyAll: destroyAllStub,
      } as any);

      sinon.stub(testModule, 'executeTests').resolves(0);

      const result = await testModule.TestModule('/module');

      expect(result).to.equal(0);
    });
  });
});
