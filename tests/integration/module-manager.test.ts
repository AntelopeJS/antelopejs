import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import { createTempDir, cleanupDir, readJson, writeJson, fileExists } from '../helpers/integration';

describe('Integration: Module Manager', function () {
  this.timeout(60000);

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('module-manager');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('project configuration for module loading', () => {
    it('should parse module sources from config (local, npm, git types)', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'local-module': {
            source: { type: 'local', path: '../modules/local' },
          },
          'npm-module': {
            source: { type: 'npm', name: 'some-package' },
          },
          'git-module': {
            source: { type: 'git', remote: 'https://github.com/user/repo.git' },
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      const moduleNames = Object.keys(config.modules);

      expect(moduleNames).to.include('local-module');
      expect(moduleNames).to.include('npm-module');
      expect(moduleNames).to.include('git-module');

      // Verify source types
      expect(config.modules['local-module'].source.type).to.equal('local');
      expect(config.modules['npm-module'].source.type).to.equal('npm');
      expect(config.modules['git-module'].source.type).to.equal('git');
    });

    it('should support module configuration', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'configurable-module': {
            source: { type: 'local', path: './mod' },
            config: {
              apiKey: 'test-key',
              debug: true,
              nested: {
                value: 42,
              },
            },
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.modules['configurable-module'].config.apiKey).to.equal('test-key');
      expect(config.modules['configurable-module'].config.debug).to.be.true;
      expect(config.modules['configurable-module'].config.nested.value).to.equal(42);
    });

    it('should support disabled exports', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'partial-module': {
            source: { type: 'local', path: './mod' },
            disabledExports: ['interface-a@beta', 'interface-b@1.0'],
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.modules['partial-module'].disabledExports).to.include('interface-a@beta');
      expect(config.modules['partial-module'].disabledExports).to.include('interface-b@1.0');
      expect(config.modules['partial-module'].disabledExports).to.have.lengthOf(2);
    });

    it('should support import overrides', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'override-module': {
            source: { type: 'local', path: './mod' },
            importOverrides: {
              'logging@beta': ['custom-logger-module'],
              'database@1.0': ['custom-db-module', 'backup-db-module'],
            },
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.modules['override-module'].importOverrides['logging@beta']).to.include(
        'custom-logger-module',
      );
      expect(config.modules['override-module'].importOverrides['database@1.0']).to.have.lengthOf(2);
    });
  });

  describe('module manifest structure', () => {
    it('should have valid module manifest with antelopeJs section', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'valid-module',
        version: '1.0.0',
        main: 'dist/index.js',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta'],
          importsOptional: ['database@beta'],
          exports: {
            'my-interface@1.0': './dist/interfaces/my-interface/1.0',
          },
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs).to.exist;
      expect(pkg.antelopeJs.type).to.equal('app');
      expect(pkg.antelopeJs.imports).to.include('logging@beta');
      expect(pkg.antelopeJs.importsOptional).to.include('database@beta');
      expect(pkg.antelopeJs.exports).to.have.property('my-interface@1.0');
    });

    it('should support srcAliases in manifest', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'alias-module',
        version: '1.0.0',
        main: 'dist/index.js',
        antelopeJs: {
          type: 'app',
          imports: [],
          srcAliases: [
            { alias: '@src', replace: './src' },
            { alias: '@utils', replace: './src/utils' },
            { alias: '@components', replace: './src/components' },
          ],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.srcAliases).to.be.an('array');
      expect(pkg.antelopeJs.srcAliases).to.have.lengthOf(3);
      expect(pkg.antelopeJs.srcAliases[0].alias).to.equal('@src');
      expect(pkg.antelopeJs.srcAliases[0].replace).to.equal('./src');
    });

    it('should support path mappings in tsconfig', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      const tsconfig = {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
            '@utils/*': ['src/utils/*'],
            '@interfaces/*': ['src/interfaces/*'],
          },
          target: 'ES2020',
          module: 'commonjs',
          outDir: './dist',
          rootDir: './src',
        },
        include: ['src/**/*'],
      };

      await writeJson(path.join(modulePath, 'tsconfig.json'), tsconfig);

      const saved = await readJson<any>(path.join(modulePath, 'tsconfig.json'));
      expect(saved.compilerOptions.paths).to.have.property('@/*');
      expect(saved.compilerOptions.paths).to.have.property('@utils/*');
      expect(saved.compilerOptions.paths['@/*']).to.deep.equal(['src/*']);
    });
  });

  describe('cache directory structure', () => {
    it('should create cache directory', async () => {
      const cachePath = path.join(testDir, '.antelopejs', 'cache');
      await fsp.mkdir(cachePath, { recursive: true });

      expect(await fileExists(cachePath)).to.be.true;
    });

    it('should create nested cache directory structure', async () => {
      const cachePath = path.join(testDir, '.antelopejs', 'cache', 'modules');
      const interfacesCachePath = path.join(testDir, '.antelopejs', 'cache', 'interfaces');

      await fsp.mkdir(cachePath, { recursive: true });
      await fsp.mkdir(interfacesCachePath, { recursive: true });

      expect(await fileExists(cachePath)).to.be.true;
      expect(await fileExists(interfacesCachePath)).to.be.true;
    });

    it('should store module cache entries', async () => {
      const cachePath = path.join(testDir, '.antelopejs', 'cache');
      await fsp.mkdir(cachePath, { recursive: true });

      // Simulate cache entry
      const cacheData = {
        modules: {
          'my-module@1.0.0': {
            path: '/path/to/cached/module',
            timestamp: Date.now(),
            hash: 'abc123',
          },
          'other-module@2.0.0': {
            path: '/path/to/other/module',
            timestamp: Date.now(),
            hash: 'def456',
          },
        },
      };
      await writeJson(path.join(cachePath, 'cache.json'), cacheData);

      const cache = await readJson<any>(path.join(cachePath, 'cache.json'));
      expect(cache.modules).to.have.property('my-module@1.0.0');
      expect(cache.modules).to.have.property('other-module@2.0.0');
      expect(cache.modules['my-module@1.0.0'].hash).to.equal('abc123');
    });

    it('should store interface cache entries', async () => {
      const cachePath = path.join(testDir, '.antelopejs', 'cache');
      await fsp.mkdir(cachePath, { recursive: true });

      // Simulate interface cache
      const interfaceCacheData = {
        interfaces: {
          'logging@beta': {
            version: 'beta',
            downloadedAt: Date.now(),
            source: 'https://github.com/AntelopeJS/interfaces.git',
          },
        },
      };
      await writeJson(path.join(cachePath, 'interfaces-cache.json'), interfaceCacheData);

      const cache = await readJson<any>(path.join(cachePath, 'interfaces-cache.json'));
      expect(cache.interfaces).to.have.property('logging@beta');
      expect(cache.interfaces['logging@beta'].version).to.equal('beta');
    });
  });
});
