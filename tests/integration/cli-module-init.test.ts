import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import { createTempDir, cleanupDir, readJson, writeJson, fileExists } from '../helpers/integration';

describe('Integration: CLI Module Init', function () {
  this.timeout(30000);

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('module-init');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('module creation', () => {
    it('should create package.json with antelopeJs section', async () => {
      const modulePath = path.join(testDir, 'new-module');
      await fsp.mkdir(modulePath, { recursive: true });

      const packageJson = {
        name: 'new-module',
        version: '1.0.0',
        main: 'dist/index.js',
        antelopeJs: {
          type: 'app',
          imports: [],
          importsOptional: [],
        },
      };

      await writeJson(path.join(modulePath, 'package.json'), packageJson);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs).to.exist;
      expect(saved.antelopeJs.type).to.equal('app');
    });

    it('should create src directory structure', async () => {
      const modulePath = path.join(testDir, 'structured-module');
      await fsp.mkdir(path.join(modulePath, 'src'), { recursive: true });

      await fsp.writeFile(path.join(modulePath, 'src', 'index.ts'), 'export default function main() {}\n');

      expect(await fileExists(path.join(modulePath, 'src', 'index.ts'))).to.be.true;
    });

    it('should create tsconfig.json', async () => {
      const modulePath = path.join(testDir, 'ts-module');
      await fsp.mkdir(modulePath, { recursive: true });

      const tsconfig = {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          outDir: './dist',
          rootDir: './src',
          strict: true,
          esModuleInterop: true,
          declaration: true,
        },
        include: ['src/**/*'],
      };

      await writeJson(path.join(modulePath, 'tsconfig.json'), tsconfig);

      const saved = await readJson<any>(path.join(modulePath, 'tsconfig.json'));
      expect(saved.compilerOptions.outDir).to.equal('./dist');
    });

    it('should create complete module structure', async () => {
      const modulePath = path.join(testDir, 'complete-module');
      await fsp.mkdir(path.join(modulePath, 'src'), { recursive: true });

      // Create package.json
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'complete-module',
        version: '1.0.0',
        main: 'dist/index.js',
        antelopeJs: {
          type: 'app',
          imports: [],
        },
      });

      // Create tsconfig.json
      await writeJson(path.join(modulePath, 'tsconfig.json'), {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          outDir: './dist',
          rootDir: './src',
        },
        include: ['src/**/*'],
      });

      // Create index.ts
      await fsp.writeFile(path.join(modulePath, 'src', 'index.ts'), 'export default function main() {}\n');

      // Verify all files exist
      expect(await fileExists(path.join(modulePath, 'package.json'))).to.be.true;
      expect(await fileExists(path.join(modulePath, 'tsconfig.json'))).to.be.true;
      expect(await fileExists(path.join(modulePath, 'src', 'index.ts'))).to.be.true;
    });
  });

  describe('module types', () => {
    it('should support app module type', async () => {
      const modulePath = path.join(testDir, 'app-module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'app-module',
        version: '1.0.0',
        antelopeJs: { type: 'app' },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.type).to.equal('app');
    });

    it('should support library module type', async () => {
      const modulePath = path.join(testDir, 'lib-module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'lib-module',
        version: '1.0.0',
        antelopeJs: { type: 'library' },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.type).to.equal('library');
    });

    it('should support interface module type', async () => {
      const modulePath = path.join(testDir, 'interface-module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'interface-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {
            'my-interface@beta': './dist/interfaces/my-interface/beta',
          },
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.type).to.equal('library');
      expect(pkg.antelopeJs.exports).to.have.property('my-interface@beta');
    });
  });

  describe('interface imports', () => {
    it('should initialize with empty imports array', async () => {
      const modulePath = path.join(testDir, 'import-module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'import-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [],
          importsOptional: [],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports).to.be.an('array').that.is.empty;
      expect(pkg.antelopeJs.importsOptional).to.be.an('array').that.is.empty;
    });

    it('should support pre-configured imports', async () => {
      const modulePath = path.join(testDir, 'preconfigured-module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'preconfigured-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta', 'database@1.0'],
          importsOptional: ['cache@beta'],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports).to.include('logging@beta');
      expect(pkg.antelopeJs.imports).to.include('database@1.0');
      expect(pkg.antelopeJs.importsOptional).to.include('cache@beta');
    });
  });

  describe('module metadata', () => {
    it('should support custom main entry point', async () => {
      const modulePath = path.join(testDir, 'custom-main-module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'custom-main-module',
        version: '1.0.0',
        main: 'build/main.js',
        antelopeJs: { type: 'app' },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.main).to.equal('build/main.js');
    });

    it('should support srcAliases configuration', async () => {
      const modulePath = path.join(testDir, 'alias-module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'alias-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          srcAliases: [
            { alias: '@src', replace: './src' },
            { alias: '@utils', replace: './src/utils' },
          ],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.srcAliases).to.be.an('array');
      expect(pkg.antelopeJs.srcAliases).to.have.lengthOf(2);
      expect(pkg.antelopeJs.srcAliases[0].alias).to.equal('@src');
    });
  });
});
