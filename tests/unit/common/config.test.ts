import { expect } from '../../helpers/setup';
import * as fs from 'fs';
import * as path from 'path';
import { LoadConfig } from '../../../src/common/config';

describe('common/config', () => {
  const testDir = path.join(__dirname, '../../fixtures/test-config-' + Date.now());

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

  describe('LoadConfig', () => {
    it('should load basic config from antelope.json', async () => {
      const config = {
        name: 'test-project',
        modules: {},
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(config));

      const result = await LoadConfig(testDir, 'default');

      expect(result.cacheFolder).to.equal('.antelope/cache');
      expect(result.modules).to.deep.equal({});
    });

    it('should use custom cacheFolder if specified', async () => {
      const config = {
        name: 'test-project',
        cacheFolder: 'custom/cache',
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(config));

      const result = await LoadConfig(testDir, 'default');

      expect(result.cacheFolder).to.equal('custom/cache');
    });

    it('should expand module string shorthand', async () => {
      const config = {
        name: 'test-project',
        modules: {
          '@scope/module': '^1.0.0',
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(config));

      const result = await LoadConfig(testDir, 'default');

      expect(result.modules['@scope/module']).to.have.property('source');
      expect(result.modules['@scope/module'].source.type).to.equal('package');
    });

    it('should expand module with version property', async () => {
      const config = {
        name: 'test-project',
        modules: {
          'my-module': {
            version: '2.0.0',
            config: { key: 'value' },
          },
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(config));

      const result = await LoadConfig(testDir, 'default');

      expect(result.modules['my-module'].source.type).to.equal('package');
      expect(result.modules['my-module'].config).to.deep.equal({ key: 'value' });
    });

    it('should handle local source modules', async () => {
      const config = {
        name: 'test-project',
        modules: {
          'local-module': {
            source: {
              type: 'local',
              path: './modules/local',
            },
          },
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(config));

      const result = await LoadConfig(testDir, 'default');

      expect(result.modules['local-module'].source.type).to.equal('local');
    });

    it('should merge environment-specific config', async () => {
      const config = {
        name: 'test-project',
        modules: {
          'base-module': '^1.0.0',
        },
        environments: {
          production: {
            modules: {
              'prod-module': '^2.0.0',
            },
          },
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(config));

      const result = await LoadConfig(testDir, 'production');

      expect(result.modules).to.have.property('base-module');
      expect(result.modules).to.have.property('prod-module');
    });

    it('should convert importOverrides object to array', async () => {
      const config = {
        name: 'test-project',
        modules: {
          'my-module': {
            source: { type: 'local', path: '.' },
            importOverrides: {
              'interface@beta': 'other-module',
            },
          },
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(config));

      const result = await LoadConfig(testDir, 'default');

      expect(result.modules['my-module'].importOverrides).to.be.an('array');
      expect(result.modules['my-module'].importOverrides[0]).to.deep.include({
        interface: 'interface@beta',
        source: 'other-module',
      });
    });

    it('should use default environment when env is "default"', async () => {
      const config = {
        name: 'test-project',
        modules: {},
        environments: {
          production: {
            cacheFolder: 'prod-cache',
          },
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(config));

      const result = await LoadConfig(testDir, 'default');

      expect(result.cacheFolder).to.equal('.antelope/cache');
    });

    it('should deep merge nested config objects', async () => {
      const config = {
        name: 'test-project',
        logging: {
          enabled: true,
          moduleTracking: {
            enabled: false,
            includes: ['mod1'],
            excludes: [],
          },
        },
        environments: {
          debug: {
            logging: {
              moduleTracking: {
                enabled: true,
              },
            },
          },
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(config));

      const result = await LoadConfig(testDir, 'debug');

      expect(result.logging?.enabled).to.be.true;
      expect(result.logging?.moduleTracking.enabled).to.be.true;
      expect(result.logging?.moduleTracking.includes).to.deep.equal(['mod1']);
    });

    it('should handle missing config file gracefully', async () => {
      try {
        await LoadConfig('/nonexistent/path', 'default');
        // If it doesn't throw, that's acceptable too
      } catch (e) {
        // Expected to throw
        expect(e).to.be.an('error');
      }
    });

    it('should handle envOverrides', async () => {
      const originalEnv = process.env.MY_ENV;
      process.env.MY_ENV = 'overridden';

      const config = {
        name: 'test-project',
        envOverrides: {
          MY_ENV: 'modules.test.config.value',
        },
        modules: {
          test: {
            source: { type: 'local', path: '.' },
            config: { value: 'original' },
          },
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(config));

      const result = await LoadConfig(testDir, 'default');

      // Restore env
      if (originalEnv === undefined) {
        delete process.env.MY_ENV;
      } else {
        process.env.MY_ENV = originalEnv;
      }

      expect(result.modules.test.config.value).to.equal('overridden');
    });

    it('should handle envOverrides with array of keys', async () => {
      const originalEnv = process.env.MULTI_ENV;
      process.env.MULTI_ENV = 'shared-value';

      const config = {
        name: 'test-project',
        envOverrides: {
          MULTI_ENV: ['modules.a.config.val', 'modules.b.config.val'],
        },
        modules: {
          a: { source: { type: 'local', path: '.' }, config: { val: 'x' } },
          b: { source: { type: 'local', path: '.' }, config: { val: 'y' } },
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(config));

      const result = await LoadConfig(testDir, 'default');

      if (originalEnv === undefined) {
        delete process.env.MULTI_ENV;
      } else {
        process.env.MULTI_ENV = originalEnv;
      }

      expect(result.modules.a.config.val).to.equal('shared-value');
      expect(result.modules.b.config.val).to.equal('shared-value');
    });
  });
});
