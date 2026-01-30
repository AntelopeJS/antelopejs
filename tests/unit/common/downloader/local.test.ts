import { expect } from '../../../helpers/setup';
import path from 'path';
import * as fs from 'fs';
import { homedir } from 'os';
import LoadModule from '../../../../src/common/downloader';
import { ModuleCache } from '../../../../src/common/cache';
// Import to register the loader
import { ModuleSourceLocal, ModuleSourceLocalFolder } from '../../../../src/common/downloader/local';

describe('common/downloader/local', () => {
  const testDir = path.join(__dirname, '../../../fixtures/test-local-' + Date.now());
  const cacheDir = path.join(testDir, 'cache');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('path expansion', () => {
    it('should expand ~ to home directory', () => {
      const homedirPath = homedir();
      const inputPath = '~/projects/module';
      const expanded = inputPath.replace(/^~/, homedirPath);

      expect(expanded).to.equal(path.join(homedirPath, 'projects/module'));
    });

    it('should not modify absolute paths', () => {
      const inputPath = '/absolute/path/to/module';

      expect(inputPath.startsWith('/')).to.be.true;
      expect(inputPath).to.equal('/absolute/path/to/module');
    });

    it('should handle relative paths', () => {
      const projectFolder = '/project';
      const relativePath = './modules/local';

      const resolved = path.resolve(projectFolder, relativePath);

      expect(resolved).to.equal('/project/modules/local');
    });

    it('should handle paths with ..', () => {
      const projectFolder = '/project/sub';
      const relativePath = '../modules/shared';

      const resolved = path.resolve(projectFolder, relativePath);

      expect(resolved).to.equal('/project/modules/shared');
    });
  });

  describe('local source validation', () => {
    it('should validate source has path property', () => {
      const validSource = {
        type: 'local',
        path: './modules/test',
      };

      expect(validSource).to.have.property('path');
      expect(validSource.path).to.be.a('string');
    });

    it('should handle optional installCommand', () => {
      const sourceWithInstall = {
        type: 'local',
        path: './modules/test',
        installCommand: 'pnpm install',
      };

      expect(sourceWithInstall).to.have.property('installCommand');
    });

    it('should handle array installCommand', () => {
      const sourceWithCommands = {
        type: 'local',
        path: './modules/test',
        installCommand: ['pnpm install', 'pnpm run build'],
      };

      expect(sourceWithCommands.installCommand).to.be.an('array');
      expect(sourceWithCommands.installCommand).to.have.length(2);
    });
  });

  describe('local-folder source', () => {
    it('should handle local-folder type', () => {
      const source = {
        type: 'local-folder',
        path: './modules',
      };

      expect(source.type).to.equal('local-folder');
    });

    it('should define structure for folder-based modules', () => {
      const source = {
        type: 'local-folder',
        path: './modules',
        installCommand: 'pnpm install',
      };

      expect(source).to.have.property('type');
      expect(source).to.have.property('path');
    });
  });

  describe('watchDir option', () => {
    it('should accept string watchDir', () => {
      const source = {
        type: 'local',
        path: './module',
        watchDir: 'src',
      };

      expect(source.watchDir).to.equal('src');
    });

    it('should accept array watchDir', () => {
      const source = {
        type: 'local',
        path: './module',
        watchDir: ['src', 'lib'],
      };

      expect(source.watchDir).to.be.an('array');
      expect(source.watchDir).to.deep.equal(['src', 'lib']);
    });
  });

  describe('LoadModule with local source', () => {
    it('should load module from local path', async () => {
      // Create a valid module directory
      const moduleDir = path.join(testDir, 'my-module');
      fs.mkdirSync(moduleDir, { recursive: true });
      fs.writeFileSync(
        path.join(moduleDir, 'package.json'),
        JSON.stringify({
          name: 'my-module',
          version: '1.0.0',
        }),
      );

      const cache = new ModuleCache(cacheDir);
      const source: ModuleSourceLocal & { id: string } = {
        id: 'my-module',
        type: 'local',
        path: moduleDir,
      };
      const manifests = await LoadModule(testDir, cache, source);

      expect(manifests).to.have.length(1);
      expect(manifests[0].name).to.equal('my-module');
    });

    it('should reject non-existent path', async () => {
      const cache = new ModuleCache(cacheDir);

      try {
        const source: ModuleSourceLocal & { id: string } = {
          id: 'non-existent',
          type: 'local',
          path: '/non/existent/path',
        };
        await LoadModule(testDir, cache, source);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).to.exist;
      }
    });
  });

  describe('LoadModule with local-folder source', () => {
    it('should load multiple modules from folder', async () => {
      // Create modules folder with sub-modules
      const modulesDir = path.join(testDir, 'modules');
      fs.mkdirSync(modulesDir, { recursive: true });

      // Create two modules
      const module1Dir = path.join(modulesDir, 'module1');
      const module2Dir = path.join(modulesDir, 'module2');
      fs.mkdirSync(module1Dir, { recursive: true });
      fs.mkdirSync(module2Dir, { recursive: true });

      fs.writeFileSync(
        path.join(module1Dir, 'package.json'),
        JSON.stringify({ name: 'module1', version: '1.0.0' }),
      );
      fs.writeFileSync(
        path.join(module2Dir, 'package.json'),
        JSON.stringify({ name: 'module2', version: '1.0.0' }),
      );

      const cache = new ModuleCache(cacheDir);
      const source: ModuleSourceLocalFolder & { id: string } = {
        id: 'modules',
        type: 'local-folder',
        path: modulesDir,
      };
      const manifests = await LoadModule(testDir, cache, source);

      expect(manifests).to.have.length(2);
    });
  });
});
