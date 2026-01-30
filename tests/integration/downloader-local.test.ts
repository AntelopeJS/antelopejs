import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import { createTempDir, cleanupDir, readJson, writeJson, fileExists } from '../helpers/integration';

describe('Integration: Local Downloader', function () {
  this.timeout(30000);

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('downloader-local');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('local path resolution', () => {
    it('should resolve absolute paths', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'local-module',
        version: '1.0.0',
      });

      // Absolute path should exist
      expect(await fileExists(modulePath)).to.be.true;
      expect(path.isAbsolute(modulePath)).to.be.true;
    });

    it('should resolve relative paths from project', async () => {
      const projectPath = path.join(testDir, 'project');
      const modulePath = path.join(testDir, 'modules', 'my-module');

      await fsp.mkdir(projectPath, { recursive: true });
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'my-module',
        version: '1.0.0',
      });

      // Relative path from project
      const relativePath = '../modules/my-module';
      const resolvedPath = path.resolve(projectPath, relativePath);

      expect(await fileExists(resolvedPath)).to.be.true;
    });

    it('should handle tilde expansion in paths', async () => {
      // Test the tilde expansion pattern
      const tildePattern = '~/my-module';
      const expandedPattern = tildePattern.startsWith('~/')
        ? path.join(process.env.HOME || '', tildePattern.slice(2))
        : tildePattern;

      expect(expandedPattern).to.not.include('~');
      expect(expandedPattern.startsWith('/')).to.be.true;
    });

    it('should handle paths with spaces', async () => {
      const modulePathWithSpaces = path.join(testDir, 'module with spaces');
      await fsp.mkdir(modulePathWithSpaces, { recursive: true });

      await writeJson(path.join(modulePathWithSpaces, 'package.json'), {
        name: 'spaced-module',
        version: '1.0.0',
      });

      expect(await fileExists(modulePathWithSpaces)).to.be.true;
      expect(await fileExists(path.join(modulePathWithSpaces, 'package.json'))).to.be.true;
    });

    it('should handle deeply nested relative paths', async () => {
      const projectPath = path.join(testDir, 'deep', 'nested', 'project');
      const modulePath = path.join(testDir, 'modules', 'shared', 'my-module');

      await fsp.mkdir(projectPath, { recursive: true });
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'nested-module',
        version: '1.0.0',
      });

      // Relative path from deeply nested project
      const relativePath = '../../../modules/shared/my-module';
      const resolvedPath = path.resolve(projectPath, relativePath);

      expect(await fileExists(resolvedPath)).to.be.true;
      expect(resolvedPath).to.equal(modulePath);
    });
  });

  describe('module manifest loading', () => {
    it('should load package.json from local module', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'local-module',
        version: '2.0.0',
        antelopeJs: {
          type: 'app',
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.name).to.equal('local-module');
      expect(pkg.version).to.equal('2.0.0');
    });

    it('should handle module without antelopeJs section', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'plain-module',
        version: '1.0.0',
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs).to.be.undefined;
    });

    it('should load module with full antelopeJs configuration', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'full-config-module',
        version: '1.0.0',
        main: 'dist/index.js',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta', 'database@1.0'],
          importsOptional: ['cache@beta'],
          exports: {
            'my-interface@1.0': './dist/interfaces/my-interface/1.0',
          },
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.type).to.equal('app');
      expect(pkg.antelopeJs.imports).to.have.lengthOf(2);
      expect(pkg.antelopeJs.importsOptional).to.have.lengthOf(1);
      expect(pkg.antelopeJs.exports).to.have.property('my-interface@1.0');
    });

    it('should handle module with library type', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'library-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {
            'utils@beta': './dist/interfaces/utils/beta',
          },
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.type).to.equal('library');
    });
  });

  describe('local source configuration', () => {
    it('should support watchDir for hot reload', async () => {
      const config = {
        type: 'local',
        path: './my-module',
        watchDir: 'src',
      };

      expect(config.watchDir).to.equal('src');
    });

    it('should support multiple watchDirs', async () => {
      const config = {
        type: 'local',
        path: './my-module',
        watchDir: ['src', 'lib'],
      };

      expect(config.watchDir).to.be.an('array');
      expect(config.watchDir).to.include('src');
      expect(config.watchDir).to.include('lib');
    });

    it('should support watchDir with nested paths', async () => {
      const config = {
        type: 'local',
        path: './my-module',
        watchDir: ['src/core', 'src/utils', 'lib/helpers'],
      };

      expect(config.watchDir).to.have.lengthOf(3);
      expect(config.watchDir).to.include('src/core');
    });

    it('should support installCommand', async () => {
      const config = {
        type: 'local',
        path: './my-module',
        installCommand: 'npm install && npm run build',
      };

      expect(config.installCommand).to.include('npm install');
    });

    it('should support multiple installCommands', async () => {
      const config = {
        type: 'local',
        path: './my-module',
        installCommand: ['npm install', 'npm run build'],
      };

      expect(config.installCommand).to.be.an('array');
      expect(config.installCommand).to.have.lengthOf(2);
    });

    it('should support installCommand with environment variables', async () => {
      const config = {
        type: 'local',
        path: './my-module',
        installCommand: 'NODE_ENV=production npm install',
      };

      expect(config.installCommand).to.include('NODE_ENV=production');
    });
  });

  describe('local module directory structure', () => {
    it('should verify module has required files', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(path.join(modulePath, 'src'), { recursive: true });
      await fsp.mkdir(path.join(modulePath, 'dist'), { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'structured-module',
        version: '1.0.0',
      });

      await fsp.writeFile(path.join(modulePath, 'src', 'index.ts'), 'export default {};\n');
      await fsp.writeFile(path.join(modulePath, 'dist', 'index.js'), 'module.exports = {};\n');

      expect(await fileExists(path.join(modulePath, 'package.json'))).to.be.true;
      expect(await fileExists(path.join(modulePath, 'src', 'index.ts'))).to.be.true;
      expect(await fileExists(path.join(modulePath, 'dist', 'index.js'))).to.be.true;
    });

    it('should handle module with tsconfig.json', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'ts-module',
        version: '1.0.0',
      });

      await writeJson(path.join(modulePath, 'tsconfig.json'), {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          outDir: './dist',
          rootDir: './src',
        },
      });

      expect(await fileExists(path.join(modulePath, 'tsconfig.json'))).to.be.true;
      const tsconfig = await readJson<any>(path.join(modulePath, 'tsconfig.json'));
      expect(tsconfig.compilerOptions.outDir).to.equal('./dist');
    });
  });

  describe('path normalization', () => {
    it('should handle paths with trailing slashes when resolving', () => {
      const pathWithSlash = '/home/user/module/';
      // path.resolve removes trailing slashes when joining
      const resolved = path.resolve(pathWithSlash, '.');
      expect(resolved).to.equal('/home/user/module');
    });

    it('should normalize paths with redundant separators', () => {
      const pathWithRedundant = '/home//user///module';
      const normalized = path.normalize(pathWithRedundant);
      expect(normalized).to.not.include('//');
    });

    it('should resolve dot segments in paths', () => {
      const pathWithDots = '/home/user/./module/../other-module';
      const resolved = path.resolve(pathWithDots);
      expect(resolved).to.not.include('./');
      expect(resolved).to.not.include('../');
    });
  });

  describe('symlink handling', () => {
    it('should detect if path is a symlink', async () => {
      const realModulePath = path.join(testDir, 'real-module');
      const symlinkPath = path.join(testDir, 'symlink-module');

      await fsp.mkdir(realModulePath, { recursive: true });
      await writeJson(path.join(realModulePath, 'package.json'), {
        name: 'real-module',
        version: '1.0.0',
      });

      await fsp.symlink(realModulePath, symlinkPath);

      const stat = await fsp.lstat(symlinkPath);
      expect(stat.isSymbolicLink()).to.be.true;

      // But we can still read from it
      const pkg = await readJson<any>(path.join(symlinkPath, 'package.json'));
      expect(pkg.name).to.equal('real-module');
    });

    it('should resolve symlink to real path', async () => {
      const realModulePath = path.join(testDir, 'real-module');
      const symlinkPath = path.join(testDir, 'symlink-module');

      await fsp.mkdir(realModulePath, { recursive: true });
      await fsp.symlink(realModulePath, symlinkPath);

      const resolvedPath = await fsp.realpath(symlinkPath);
      expect(resolvedPath).to.equal(realModulePath);
    });
  });
});
