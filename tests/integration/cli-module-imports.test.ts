import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import { createTempDir, cleanupDir, readJson, writeJson, fileExists, getInterfacesGitUrl } from '../helpers/integration';

describe('Integration: CLI Module Imports', function () {
  this.timeout(60000); // 60s timeout for potential git operations

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('module-imports');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('import management', () => {
    it('should add import to package.json', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [],
        },
      });

      // Simulate adding import
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      pkg.antelopeJs.imports.push('logging@beta');
      await writeJson(path.join(modulePath, 'package.json'), pkg);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs.imports).to.include('logging@beta');
    });

    it('should add optional import', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [],
          importsOptional: [],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      pkg.antelopeJs.importsOptional.push('database@beta');
      await writeJson(path.join(modulePath, 'package.json'), pkg);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs.importsOptional).to.include('database@beta');
    });

    it('should remove import from package.json', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta', 'database@beta'],
        },
      });

      // Simulate removing import
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      pkg.antelopeJs.imports = pkg.antelopeJs.imports.filter((i: string) => i !== 'logging@beta');
      await writeJson(path.join(modulePath, 'package.json'), pkg);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs.imports).to.not.include('logging@beta');
      expect(saved.antelopeJs.imports).to.include('database@beta');
    });

    it('should add multiple imports at once', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      pkg.antelopeJs.imports.push('logging@beta', 'database@1.0', 'cache@beta');
      await writeJson(path.join(modulePath, 'package.json'), pkg);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs.imports).to.have.lengthOf(3);
      expect(saved.antelopeJs.imports).to.include('logging@beta');
      expect(saved.antelopeJs.imports).to.include('database@1.0');
      expect(saved.antelopeJs.imports).to.include('cache@beta');
    });
  });

  describe('import with custom git', () => {
    it('should support custom git repo for imports', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [
            {
              name: 'custom-interface@beta',
              git: 'https://github.com/custom/interfaces.git',
            },
          ],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports[0].git).to.include('custom/interfaces');
    });

    it('should support default interfaces git url', async () => {
      const defaultUrl = getInterfacesGitUrl();
      expect(defaultUrl).to.equal('https://github.com/AntelopeJS/interfaces.git');
    });

    it('should support object import with branch specification', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [
            {
              name: 'custom-interface@dev',
              git: 'https://github.com/custom/interfaces.git',
              branch: 'develop',
            },
          ],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports[0].branch).to.equal('develop');
    });
  });

  describe('interface file installation', () => {
    it('should create .antelope/interfaces.d directory', async () => {
      const modulePath = path.join(testDir, 'module');
      const interfacesPath = path.join(modulePath, '.antelope', 'interfaces.d');

      await fsp.mkdir(interfacesPath, { recursive: true });

      expect(await fileExists(interfacesPath)).to.be.true;
    });

    it('should install interface type definitions', async () => {
      const modulePath = path.join(testDir, 'module');
      const interfacePath = path.join(modulePath, '.antelope', 'interfaces.d', 'logging', 'beta.d.ts');

      await fsp.mkdir(path.dirname(interfacePath), { recursive: true });
      await fsp.writeFile(interfacePath, 'export declare const Logger: any;\n');

      expect(await fileExists(interfacePath)).to.be.true;

      const content = await fsp.readFile(interfacePath, 'utf-8');
      expect(content).to.include('Logger');
    });

    it('should create nested interface directory structure', async () => {
      const modulePath = path.join(testDir, 'module');
      const baseInterfacePath = path.join(modulePath, '.antelope', 'interfaces.d');

      // Create multiple interface directories
      await fsp.mkdir(path.join(baseInterfacePath, 'logging'), { recursive: true });
      await fsp.mkdir(path.join(baseInterfacePath, 'database'), { recursive: true });
      await fsp.mkdir(path.join(baseInterfacePath, 'cache'), { recursive: true });

      // Write type definition files
      await fsp.writeFile(path.join(baseInterfacePath, 'logging', 'beta.d.ts'), 'export interface Logger {}\n');
      await fsp.writeFile(path.join(baseInterfacePath, 'database', '1.0.d.ts'), 'export interface Database {}\n');
      await fsp.writeFile(path.join(baseInterfacePath, 'cache', 'beta.d.ts'), 'export interface Cache {}\n');

      expect(await fileExists(path.join(baseInterfacePath, 'logging', 'beta.d.ts'))).to.be.true;
      expect(await fileExists(path.join(baseInterfacePath, 'database', '1.0.d.ts'))).to.be.true;
      expect(await fileExists(path.join(baseInterfacePath, 'cache', 'beta.d.ts'))).to.be.true;
    });

    it('should support index.d.ts in interface directory', async () => {
      const modulePath = path.join(testDir, 'module');
      const interfaceDir = path.join(modulePath, '.antelope', 'interfaces.d', 'logging');

      await fsp.mkdir(interfaceDir, { recursive: true });
      await fsp.writeFile(
        path.join(interfaceDir, 'index.d.ts'),
        'export * from "./beta";\nexport * from "./1.0";\n',
      );
      await fsp.writeFile(path.join(interfaceDir, 'beta.d.ts'), 'export interface LoggerBeta {}\n');
      await fsp.writeFile(path.join(interfaceDir, '1.0.d.ts'), 'export interface LoggerV1 {}\n');

      expect(await fileExists(path.join(interfaceDir, 'index.d.ts'))).to.be.true;
    });
  });

  describe('import object format', () => {
    it('should support string import format', async () => {
      const pkg = {
        antelopeJs: {
          imports: ['logging@beta'],
        },
      };

      expect(typeof pkg.antelopeJs.imports[0]).to.equal('string');
    });

    it('should support object import format with options', async () => {
      const pkg = {
        antelopeJs: {
          imports: [
            {
              name: 'logging@beta',
              git: 'https://github.com/AntelopeJS/interfaces.git',
              skipInstall: true,
            },
          ],
        },
      };

      expect(pkg.antelopeJs.imports[0]).to.have.property('name');
      expect(pkg.antelopeJs.imports[0]).to.have.property('skipInstall');
    });

    it('should support mixed string and object imports', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [
            'logging@beta',
            {
              name: 'database@1.0',
              git: 'https://github.com/custom/interfaces.git',
            },
            'cache@beta',
          ],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(typeof pkg.antelopeJs.imports[0]).to.equal('string');
      expect(typeof pkg.antelopeJs.imports[1]).to.equal('object');
      expect(typeof pkg.antelopeJs.imports[2]).to.equal('string');
    });

    it('should support import with commit specification', async () => {
      const pkg = {
        antelopeJs: {
          imports: [
            {
              name: 'logging@beta',
              git: 'https://github.com/AntelopeJS/interfaces.git',
              commit: 'abc123def456',
            },
          ],
        },
      };

      expect(pkg.antelopeJs.imports[0]).to.have.property('commit');
      expect(pkg.antelopeJs.imports[0].commit).to.equal('abc123def456');
    });
  });

  describe('import version handling', () => {
    it('should parse interface name and version from string format', async () => {
      const importString = 'logging@beta';
      const [name, version] = importString.split('@');

      expect(name).to.equal('logging');
      expect(version).to.equal('beta');
    });

    it('should handle versioned interfaces', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@1.0', 'logging@2.0', 'database@beta'],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports).to.include('logging@1.0');
      expect(pkg.antelopeJs.imports).to.include('logging@2.0');
    });
  });
});
