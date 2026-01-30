import { expect } from '../../helpers/setup';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleCache } from '../../../src/common/cache';

describe('common/cache', () => {
  const testCacheDir = path.join(__dirname, '../../fixtures/test-cache-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testCacheDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('ModuleCache', () => {
    describe('constructor', () => {
      it('should create cache with path', () => {
        const cache = new ModuleCache(testCacheDir);
        expect(cache.path).to.equal(testCacheDir);
      });
    });

    describe('load', () => {
      it('should load manifest from disk', async () => {
        const manifestData = { 'test-module': '1.0.0' };
        fs.writeFileSync(path.join(testCacheDir, 'manifest.json'), JSON.stringify(manifestData));

        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        expect(cache.getVersion('test-module')).to.equal('1.0.0');
      });

      it('should create empty manifest if file does not exist', async () => {
        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        expect(cache.getVersion('any-module')).to.be.undefined;
      });

      it('should handle corrupted manifest file gracefully', async () => {
        fs.writeFileSync(path.join(testCacheDir, 'manifest.json'), 'not valid json');

        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        expect(cache.getVersion('any-module')).to.be.undefined;
      });
    });

    describe('getVersion', () => {
      it('should return cached version', async () => {
        const manifestData = { 'my-module': '1.0.0' };
        fs.writeFileSync(path.join(testCacheDir, 'manifest.json'), JSON.stringify(manifestData));

        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        const result = cache.getVersion('my-module');
        expect(result).to.equal('1.0.0');
      });

      it('should return undefined for non-cached module', async () => {
        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        const result = cache.getVersion('unknown');
        expect(result).to.be.undefined;
      });
    });

    describe('setVersion', () => {
      it('should set version in manifest', async () => {
        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        cache.setVersion('new-module', '2.0.0');

        const result = cache.getVersion('new-module');
        expect(result).to.equal('2.0.0');
      });

      it('should update existing version', async () => {
        const manifestData = { 'my-module': '1.0.0' };
        fs.writeFileSync(path.join(testCacheDir, 'manifest.json'), JSON.stringify(manifestData));

        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        cache.setVersion('my-module', '2.0.0');

        expect(cache.getVersion('my-module')).to.equal('2.0.0');
      });
    });

    describe('hasVersion', () => {
      it('should return true for matching semver range', async () => {
        const manifestData = { 'cached-module': '1.5.0' };
        fs.writeFileSync(path.join(testCacheDir, 'manifest.json'), JSON.stringify(manifestData));

        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        expect(cache.hasVersion('cached-module', '^1.0.0')).to.be.true;
      });

      it('should return false for non-matching semver range', async () => {
        const manifestData = { 'cached-module': '1.5.0' };
        fs.writeFileSync(path.join(testCacheDir, 'manifest.json'), JSON.stringify(manifestData));

        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        expect(cache.hasVersion('cached-module', '^2.0.0')).to.be.false;
      });

      it('should return false for non-cached module', async () => {
        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        expect(cache.hasVersion('unknown', '1.0.0')).to.be.false;
      });

      it('should handle exact versions', async () => {
        const manifestData = { 'my-module': '1.2.3' };
        fs.writeFileSync(path.join(testCacheDir, 'manifest.json'), JSON.stringify(manifestData));

        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        expect(cache.hasVersion('my-module', '1.2.3')).to.be.true;
        expect(cache.hasVersion('my-module', '1.2.4')).to.be.false;
      });
    });

    describe('getFolder', () => {
      it('should return path for module', async () => {
        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        const folder = await cache.getFolder('my-module');

        expect(folder).to.include('my-module');
        expect(folder).to.include(testCacheDir);
      });

      it('should create folder by default', async () => {
        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        const folder = await cache.getFolder('my-module');

        expect(fs.existsSync(folder)).to.be.true;
      });

      it('should clean existing folder by default', async () => {
        const moduleDir = path.join(testCacheDir, 'clean-test');
        fs.mkdirSync(moduleDir, { recursive: true });
        fs.writeFileSync(path.join(moduleDir, 'old-file.txt'), 'old content');

        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        const folder = await cache.getFolder('clean-test');

        expect(fs.existsSync(path.join(folder, 'old-file.txt'))).to.be.false;
      });

      it('should skip clean when noClean is true', async () => {
        const moduleDir = path.join(testCacheDir, 'no-clean-test');
        fs.mkdirSync(moduleDir, { recursive: true });
        fs.writeFileSync(path.join(moduleDir, 'keep-file.txt'), 'keep content');

        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        const folder = await cache.getFolder('no-clean-test', true);

        expect(fs.existsSync(path.join(folder, 'keep-file.txt'))).to.be.true;
      });
    });

    describe('getTemp', () => {
      it('should return temp directory path', async () => {
        const temp = await ModuleCache.getTemp();

        expect(temp).to.include('ajs-');
        expect(fs.existsSync(temp)).to.be.true;

        // Clean up
        fs.rmSync(temp, { recursive: true, force: true });
      });
    });

    describe('transfer', () => {
      it('should copy folder and update manifest', async () => {
        const sourceDir = path.join(testCacheDir, 'source');
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(path.join(sourceDir, 'test.txt'), 'content');

        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        const dest = await cache.transfer(sourceDir, 'transferred-module', '1.0.0');

        expect(fs.existsSync(path.join(dest, 'test.txt'))).to.be.true;
        expect(cache.getVersion('transferred-module')).to.equal('1.0.0');
      });

      it('should remove source folder after copy', async () => {
        const sourceDir = path.join(testCacheDir, 'source-remove');
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(path.join(sourceDir, 'test.txt'), 'content');

        const cache = new ModuleCache(testCacheDir);
        await cache.load();

        await cache.transfer(sourceDir, 'module', '1.0.0');

        expect(fs.existsSync(sourceDir)).to.be.false;
      });
    });
  });
});
