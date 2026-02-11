import { expect } from 'chai';
import sinon from 'sinon';
import { AntelopeConfig } from '../../../src/types';
import * as configLoader from '../../../src/core/config/config-loader';
import { ConfigLoader } from '../../../src/core/config/config-loader';
import { InMemoryFileSystem } from '../../helpers/in-memory-filesystem';

describe('ConfigLoader', () => {
  let fs: InMemoryFileSystem;
  let loader: ConfigLoader;
  let loadTsConfigFileStub: sinon.SinonStub;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    loader = new ConfigLoader(fs);
    loadTsConfigFileStub = sinon.stub(configLoader, 'loadTsConfigFile');
  });

  afterEach(() => {
    sinon.restore();
  });

  async function mockTsConfig(config: AntelopeConfig): Promise<void> {
    await fs.writeFile('/project/antelope.config.ts', '');
    loadTsConfigFileStub.resolves(config);
  }

  describe('load', () => {
    it('loads basic config', async () => {
      await mockTsConfig({
        name: 'test-project',
        modules: {
          'my-module': '1.0.0',
        },
      });

      const config = await loader.load('/project');

      expect(config.name).to.equal('test-project');
      expect(config.modules['my-module']).to.deep.include({
        source: { type: 'package', package: 'my-module', version: '1.0.0' },
      });
    });

    it('merges environment config', async () => {
      await mockTsConfig({
        name: 'test-project',
        cacheFolder: '.cache',
        environments: {
          production: {
            cacheFolder: '/var/cache',
          },
        },
      });

      const config = await loader.load('/project', 'production');

      expect(config.cacheFolder).to.equal('/var/cache');
    });

    it('loads module-specific config files', async () => {
      await mockTsConfig({
        name: 'test',
        modules: { database: '1.0.0' },
      });
      await fs.writeFile(
        '/project/antelope.database.json',
        JSON.stringify({
          host: 'localhost',
          port: 5432,
        }),
      );

      const config = await loader.load('/project');

      expect(config.modules['database'].config).to.deep.equal({
        host: 'localhost',
        port: 5432,
      });
    });

    it('processes template strings', async () => {
      await mockTsConfig({
        name: 'my-app',
        cacheFolder: '${name}/.cache',
      });

      const config = await loader.load('/project');

      expect(config.cacheFolder).to.equal('my-app/.cache');
    });

    it('defaults cacheFolder when missing', async () => {
      await mockTsConfig({
        name: 'my-app',
        modules: {},
      });

      const config = await loader.load('/project');

      expect(config.cacheFolder).to.equal('.antelope/cache');
    });

    it('defaults cacheFolder when null', async () => {
      await mockTsConfig({
        name: 'my-app',
        cacheFolder: null as unknown as string,
        modules: {},
      });

      const config = await loader.load('/project');

      expect(config.cacheFolder).to.equal('.antelope/cache');
    });

    it('preserves test section from config', async () => {
      const setupFn = async () => {};
      const cleanupFn = async () => {};
      await mockTsConfig({
        name: 'test-project',
        modules: {},
        test: {
          folder: 'specs',
          setup: setupFn,
          cleanup: cleanupFn,
        },
      });

      const config = await loader.load('/project');

      expect(config.test).to.deep.equal({
        folder: 'specs',
        setup: setupFn,
        cleanup: cleanupFn,
      });
    });

    it('applies environment test overrides', async () => {
      const setupFn = async () => {};
      const cleanupFn = async () => {};
      await mockTsConfig({
        name: 'test-project',
        modules: {},
        test: {
          folder: 'specs',
          setup: setupFn,
          cleanup: cleanupFn,
        },
        environments: {
          production: {
            test: {
              folder: 'e2e',
            },
          },
        },
      });

      const config = await loader.load('/project', 'production');

      expect(config.test).to.deep.equal({
        folder: 'e2e',
        setup: setupFn,
        cleanup: cleanupFn,
      });
    });

    it('returns undefined test when config has no test section', async () => {
      await mockTsConfig({
        name: 'test-project',
        modules: {},
      });

      const config = await loader.load('/project');

      expect(config.test).to.equal(undefined);
    });

    it('merges module config when base config is undefined', async () => {
      await mockTsConfig({
        name: 'test',
        modules: { database: '1.0.0' },
      });
      await fs.writeFile(
        '/project/antelope.database.json',
        JSON.stringify({
          host: 'localhost',
        }),
      );

      sinon.stub((loader as any).parser, 'expandModuleShorthand').returns({
        database: {
          source: { type: 'package', package: 'database', version: '1.0.0' },
          config: undefined,
          importOverrides: [],
          disabledExports: [],
        },
      });

      const config = await loader.load('/project');

      expect(config.modules.database.config).to.deep.equal({ host: 'localhost' });
    });

    it('uses default cache folder when env overrides return undefined', async () => {
      await mockTsConfig({
        name: 'my-app',
        cacheFolder: '/custom-cache',
        modules: {},
      });

      sinon.stub((loader as any).parser, 'applyEnvOverrides').callsFake((config: any) => ({
        ...config,
        cacheFolder: undefined,
      }));

      const config = await loader.load('/project');

      expect(config.cacheFolder).to.equal('.antelope/cache');
    });

    it('passes environment to loadTsConfigFile', async () => {
      await mockTsConfig({
        name: 'env-project',
        modules: {},
      });

      await loader.load('/project', 'production');

      expect(loadTsConfigFileStub.calledOnce).to.equal(true);
      expect(loadTsConfigFileStub.firstCall.args[1]).to.equal('production');
    });

    it('loads config from explicit config path', async () => {
      await fs.writeFile('/other/my-config.ts', '');
      loadTsConfigFileStub.resolves({
        name: 'explicit-path-project',
        modules: {},
      });

      const config = await loader.load('/project', undefined, '/other/my-config.ts');

      expect(config.name).to.equal('explicit-path-project');
      expect(loadTsConfigFileStub.calledOnce).to.equal(true);
      expect(loadTsConfigFileStub.firstCall.args[0]).to.equal('/other/my-config.ts');
    });

    it('throws when config file is missing', async () => {
      try {
        await loader.load('/project');
        expect.fail('should have thrown');
      } catch (error: any) {
        expect(error.message).to.include('antelope.config.ts');
      }
    });
  });
});
