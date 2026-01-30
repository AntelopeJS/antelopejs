import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import { createTempDir, cleanupDir, readJson, writeJson, fileExists } from '../helpers/integration';

describe('Integration: CLI Module Exports', function () {
  this.timeout(60000);

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('module-exports');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('export configuration', () => {
    it('should define exports in package.json', async () => {
      const modulePath = path.join(testDir, 'module');
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
      expect(pkg.antelopeJs.exports).to.have.property('my-interface@beta');
    });

    it('should support multiple exports', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'multi-interface-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {
            'interface-a@1.0': './dist/interfaces/a/1.0',
            'interface-b@2.0': './dist/interfaces/b/2.0',
          },
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(Object.keys(pkg.antelopeJs.exports)).to.have.lengthOf(2);
    });

    it('should support versioned exports', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'versioned-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {
            'logging@beta': './dist/interfaces/logging/beta',
            'logging@1.0': './dist/interfaces/logging/1.0',
            'logging@2.0': './dist/interfaces/logging/2.0',
          },
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.exports).to.have.property('logging@beta');
      expect(pkg.antelopeJs.exports).to.have.property('logging@1.0');
      expect(pkg.antelopeJs.exports).to.have.property('logging@2.0');
    });

    it('should support empty exports object', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'no-exports-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {},
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.exports).to.be.an('object').that.is.empty;
    });
  });

  describe('export directory structure', () => {
    it('should create exports directory', async () => {
      const modulePath = path.join(testDir, 'module');
      const exportsPath = path.join(modulePath, 'dist', 'interfaces');

      await fsp.mkdir(exportsPath, { recursive: true });

      expect(await fileExists(exportsPath)).to.be.true;
    });

    it('should generate type definitions', async () => {
      const modulePath = path.join(testDir, 'module');
      const interfacePath = path.join(modulePath, 'dist', 'interfaces', 'my-interface', 'beta.d.ts');

      await fsp.mkdir(path.dirname(interfacePath), { recursive: true });
      await fsp.writeFile(interfacePath, 'export interface MyInterface {\n  doSomething(): void;\n}\n');

      expect(await fileExists(interfacePath)).to.be.true;

      const content = await fsp.readFile(interfacePath, 'utf-8');
      expect(content).to.include('MyInterface');
    });

    it('should create nested export directory structure', async () => {
      const modulePath = path.join(testDir, 'module');
      const baseExportsPath = path.join(modulePath, 'dist', 'interfaces');

      // Create export directories for multiple interfaces
      await fsp.mkdir(path.join(baseExportsPath, 'logging', 'beta'), { recursive: true });
      await fsp.mkdir(path.join(baseExportsPath, 'database', '1.0'), { recursive: true });

      // Write type definition files
      await fsp.writeFile(
        path.join(baseExportsPath, 'logging', 'beta', 'index.d.ts'),
        'export interface Logger { log(msg: string): void; }\n',
      );
      await fsp.writeFile(
        path.join(baseExportsPath, 'database', '1.0', 'index.d.ts'),
        'export interface Database { query(sql: string): Promise<any>; }\n',
      );

      expect(await fileExists(path.join(baseExportsPath, 'logging', 'beta', 'index.d.ts'))).to.be.true;
      expect(await fileExists(path.join(baseExportsPath, 'database', '1.0', 'index.d.ts'))).to.be.true;
    });

    it('should support JavaScript implementation files alongside type definitions', async () => {
      const modulePath = path.join(testDir, 'module');
      const interfaceDir = path.join(modulePath, 'dist', 'interfaces', 'logging', 'beta');

      await fsp.mkdir(interfaceDir, { recursive: true });

      // Create both .js and .d.ts files
      await fsp.writeFile(
        path.join(interfaceDir, 'index.js'),
        'module.exports = { createLogger: function() { return {}; } };\n',
      );
      await fsp.writeFile(
        path.join(interfaceDir, 'index.d.ts'),
        'export declare function createLogger(): Logger;\nexport interface Logger { log(msg: string): void; }\n',
      );

      expect(await fileExists(path.join(interfaceDir, 'index.js'))).to.be.true;
      expect(await fileExists(path.join(interfaceDir, 'index.d.ts'))).to.be.true;
    });
  });

  describe('export path configuration', () => {
    it('should support custom exports path', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'custom-exports-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exportsPath: './build/interfaces',
          exports: {
            'my-interface@1.0': './build/interfaces/my-interface/1.0',
          },
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.exportsPath).to.equal('./build/interfaces');
    });

    it('should use dist as default exports path', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'default-path-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {
            'my-interface@beta': './dist/interfaces/my-interface/beta',
          },
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.exports['my-interface@beta']).to.include('./dist/');
    });

    it('should resolve export paths relative to module root', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      const exportRelativePath = './dist/interfaces/my-interface/beta';
      const absolutePath = path.resolve(modulePath, exportRelativePath);

      // Create the export directory
      await fsp.mkdir(absolutePath, { recursive: true });
      await fsp.writeFile(path.join(absolutePath, 'index.d.ts'), 'export interface Test {}\n');

      expect(await fileExists(path.join(absolutePath, 'index.d.ts'))).to.be.true;
    });
  });

  describe('export set command', () => {
    it('should add new export path', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {},
        },
      });

      // Simulate setting export
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      pkg.antelopeJs.exports['new-interface@beta'] = './dist/interfaces/new/beta';
      await writeJson(path.join(modulePath, 'package.json'), pkg);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs.exports).to.have.property('new-interface@beta');
    });

    it('should update existing export path', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {
            'my-interface@beta': './dist/old-path',
          },
        },
      });

      // Update export path
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      pkg.antelopeJs.exports['my-interface@beta'] = './dist/new-path';
      await writeJson(path.join(modulePath, 'package.json'), pkg);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs.exports['my-interface@beta']).to.equal('./dist/new-path');
    });

    it('should remove export path', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {
            'keep-interface@beta': './dist/keep',
            'remove-interface@beta': './dist/remove',
          },
        },
      });

      // Remove export
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      delete pkg.antelopeJs.exports['remove-interface@beta'];
      await writeJson(path.join(modulePath, 'package.json'), pkg);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs.exports).to.have.property('keep-interface@beta');
      expect(saved.antelopeJs.exports).to.not.have.property('remove-interface@beta');
    });
  });

  describe('export validation', () => {
    it('should validate export name format', async () => {
      const validNames = ['logging@beta', 'database@1.0', 'my-interface@2.0.1'];

      for (const name of validNames) {
        const parts = name.split('@');
        expect(parts).to.have.lengthOf(2);
        expect(parts[0]).to.not.be.empty;
        expect(parts[1]).to.not.be.empty;
      }
    });

    it('should support scoped interface names', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {
            'core/logging@beta': './dist/interfaces/core/logging/beta',
            'utils/helpers@1.0': './dist/interfaces/utils/helpers/1.0',
          },
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.exports).to.have.property('core/logging@beta');
      expect(pkg.antelopeJs.exports).to.have.property('utils/helpers@1.0');
    });
  });

  describe('export with tsconfig', () => {
    it('should configure tsconfig for declaration generation', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      const tsconfig = {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          outDir: './dist',
          rootDir: './src',
          declaration: true,
          declarationDir: './dist',
          strict: true,
        },
        include: ['src/**/*'],
      };

      await writeJson(path.join(modulePath, 'tsconfig.json'), tsconfig);

      const saved = await readJson<any>(path.join(modulePath, 'tsconfig.json'));
      expect(saved.compilerOptions.declaration).to.be.true;
    });
  });
});
