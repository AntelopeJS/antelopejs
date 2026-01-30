import { expect } from '../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import { LoadConfig } from '../../src/common/config';
import { ModuleCache } from '../../src/common/cache';

describe('Integration: Config Loading', () => {
  const testDir = path.join(__dirname, '../fixtures/test-config-loading-' + Date.now());

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
    it('should load config from antelope.json', async () => {
      const configData = {
        name: 'test-project',
        modules: {
          'test-module': {
            source: {
              type: 'package',
              package: '@test/module',
              version: '1.0.0',
            },
          },
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(configData));

      const result = await LoadConfig(testDir, 'default');

      expect(result.modules).to.be.an('object');
      expect(result.modules).to.have.property('test-module');
    });

    it('should handle config with logging settings', async () => {
      const configData = {
        name: 'test-project',
        modules: {},
        logging: {
          enabled: true,
          moduleTracking: { enabled: false, includes: [], excludes: [] },
          channelFilter: { 'test.*': 'debug' },
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(configData));

      const result = await LoadConfig(testDir, 'default');

      expect(result.logging).to.exist;
      expect(result.logging?.enabled).to.be.true;
      expect(result.logging?.channelFilter).to.have.property('test.*');
    });

    it('should handle config with module configs', async () => {
      const configData = {
        name: 'test-project',
        modules: {
          'test-module': {
            source: {
              type: 'local',
              path: './modules/test',
            },
            config: { customSetting: true },
          },
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(configData));

      const result = await LoadConfig(testDir, 'default');

      expect((result.modules['test-module'] as any).config).to.deep.equal({ customSetting: true });
    });

    it('should expand version shorthand', async () => {
      const configData = {
        name: 'test-project',
        modules: {
          '@test/module': '1.0.0',
        },
      };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(configData));

      const result = await LoadConfig(testDir, 'default');

      const mod = result.modules['@test/module'] as any;
      expect(mod.source.type).to.equal('package');
      expect(mod.source.version).to.equal('1.0.0');
    });
  });

  describe('ModuleCache', () => {
    const cacheDir = path.join(__dirname, '../fixtures/test-module-cache-' + Date.now());

    beforeEach(() => {
      fs.mkdirSync(cacheDir, { recursive: true });
    });

    afterEach(() => {
      try {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should create cache instance', () => {
      const cache = new ModuleCache(cacheDir);
      expect(cache).to.be.instanceof(ModuleCache);
    });

    it('should expose path property', () => {
      const cache = new ModuleCache(cacheDir);
      expect(cache.path).to.equal(cacheDir);
    });

    it('should load cache from manifest', async () => {
      const manifestData = {
        'test-module': '1.0.0',
        'other-module': '2.0.0',
      };
      fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify(manifestData));

      const cache = new ModuleCache(cacheDir);
      await cache.load();

      expect(cache.getVersion('test-module')).to.equal('1.0.0');
      expect(cache.getVersion('other-module')).to.equal('2.0.0');
    });

    it('should handle missing manifest file', async () => {
      const cache = new ModuleCache(cacheDir);
      await cache.load();

      expect(cache.getVersion('test-module')).to.be.undefined;
    });

    it('should check version satisfaction', async () => {
      const manifestData = {
        'test-module': '1.5.0',
      };
      fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify(manifestData));

      const cache = new ModuleCache(cacheDir);
      await cache.load();

      expect(cache.hasVersion('test-module', '^1.0.0')).to.be.true;
      expect(cache.hasVersion('test-module', '^2.0.0')).to.be.false;
    });

    it('should set version', async () => {
      const cache = new ModuleCache(cacheDir);
      await cache.load();

      cache.setVersion('new-module', '3.0.0');
      expect(cache.getVersion('new-module')).to.equal('3.0.0');
    });

    it('should provide temp folder', async () => {
      const tempPath = await ModuleCache.getTemp();
      expect(tempPath).to.include('ajs-');
      expect(fs.existsSync(tempPath)).to.be.true;

      // Clean up
      fs.rmSync(tempPath, { recursive: true, force: true });
    });
  });
});
