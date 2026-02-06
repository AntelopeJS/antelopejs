import { expect } from 'chai';
import sinon from 'sinon';
import { ConfigLoader } from '../../../src/core/config/config-loader';
import { InMemoryFileSystem } from '../../helpers/in-memory-filesystem';

describe('ConfigLoader', () => {
  let fs: InMemoryFileSystem;
  let loader: ConfigLoader;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    loader = new ConfigLoader(fs);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('load', () => {
    it('should load basic config', async () => {
      await fs.writeFile(
        '/project/antelope.json',
        JSON.stringify({
          name: 'test-project',
          modules: {
            'my-module': '1.0.0',
          },
        }),
      );

      const config = await loader.load('/project');

      expect(config.name).to.equal('test-project');
      expect(config.modules['my-module']).to.deep.include({
        source: { type: 'package', package: 'my-module', version: '1.0.0' },
      });
    });

    it('should merge environment config', async () => {
      await fs.writeFile(
        '/project/antelope.json',
        JSON.stringify({
          name: 'test-project',
          cacheFolder: '.cache',
          environments: {
            production: {
              cacheFolder: '/var/cache',
            },
          },
        }),
      );

      const config = await loader.load('/project', 'production');

      expect(config.cacheFolder).to.equal('/var/cache');
    });

    it('should load module-specific config files', async () => {
      await fs.writeFile(
        '/project/antelope.json',
        JSON.stringify({
          name: 'test',
          modules: { database: '1.0.0' },
        }),
      );
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

    it('should process template strings', async () => {
      await fs.writeFile(
        '/project/antelope.json',
        JSON.stringify({
          name: 'my-app',
          cacheFolder: '${name}/.cache',
        }),
      );

      const config = await loader.load('/project');

      expect(config.cacheFolder).to.equal('my-app/.cache');
    });

    it('defaults cacheFolder when missing', async () => {
      await fs.writeFile(
        '/project/antelope.json',
        JSON.stringify({
          name: 'my-app',
          modules: {},
        }),
      );

      const config = await loader.load('/project');

      expect(config.cacheFolder).to.equal('.antelope/cache');
    });

    it('defaults cacheFolder when null', async () => {
      await fs.writeFile(
        '/project/antelope.json',
        JSON.stringify({
          name: 'my-app',
          cacheFolder: null,
          modules: {},
        }),
      );

      const config = await loader.load('/project');

      expect(config.cacheFolder).to.equal('.antelope/cache');
    });

    it('merges module config when base config is undefined', async () => {
      await fs.writeFile(
        '/project/antelope.json',
        JSON.stringify({
          name: 'test',
          modules: { database: '1.0.0' },
        }),
      );
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
  });
});
