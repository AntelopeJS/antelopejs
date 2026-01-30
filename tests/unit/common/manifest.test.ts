import { expect } from '../../helpers/setup';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleManifest, mapModuleImport, ModulePackageJson } from '../../../src/common/manifest';

describe('common/manifest', () => {
  const testDir = path.join(__dirname, '../../fixtures/test-manifest-' + Date.now());

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

  describe('mapModuleImport', () => {
    it('should return string as-is', () => {
      const result = mapModuleImport('core@beta');
      expect(result).to.equal('core@beta');
    });

    it('should extract name from object import', () => {
      const result = mapModuleImport({ name: 'logging@beta' });
      expect(result).to.equal('logging@beta');
    });

    it('should handle object with git property', () => {
      const result = mapModuleImport({
        name: 'custom@1.0',
        git: 'https://github.com/example/repo',
      });
      expect(result).to.equal('custom@1.0');
    });

    it('should handle object with skipInstall property', () => {
      const result = mapModuleImport({
        name: 'test@beta',
        skipInstall: true,
      });
      expect(result).to.equal('test@beta');
    });
  });

  describe('ModulePackageJson interface', () => {
    it('should have required properties', () => {
      const pkg: ModulePackageJson = {
        name: 'test-module',
        version: '1.0.0',
      };

      expect(pkg.name).to.equal('test-module');
      expect(pkg.version).to.equal('1.0.0');
    });

    it('should support optional properties', () => {
      const pkg: ModulePackageJson = {
        name: 'test-module',
        version: '1.0.0',
        description: 'A test module',
        author: 'Test Author',
      };

      expect(pkg.description).to.equal('A test module');
    });

    it('should support antelopeJs configuration', () => {
      const pkg: ModulePackageJson = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: ['core@beta'],
          importsOptional: [],
          exportsPath: 'dist/interfaces',
        },
      };

      expect(pkg.antelopeJs?.imports).to.deep.equal(['core@beta']);
      expect(pkg.antelopeJs?.exportsPath).to.equal('dist/interfaces');
    });

    it('should support paths configuration', () => {
      const pkg: ModulePackageJson = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          paths: {
            '@src/*': ['src/*'],
          },
        },
      };

      expect(pkg.antelopeJs?.paths).to.have.property('@src/*');
    });

    it('should support moduleAliases', () => {
      const pkg: ModulePackageJson = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          moduleAliases: {
            '@src': 'dist',
          },
        },
      };

      expect(pkg.antelopeJs?.moduleAliases).to.have.property('@src');
    });

    it('should support _moduleAliases (legacy)', () => {
      const pkg: ModulePackageJson = {
        name: 'test-module',
        version: '1.0.0',
        _moduleAliases: {
          '@root': '.',
        },
      };

      expect(pkg._moduleAliases).to.have.property('@root');
    });
  });

  describe('ModuleManifest.readManifest', () => {
    it('should read package.json', () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const result = ModuleManifest.readManifest(testDir);

      expect(result.name).to.equal('test-module');
      expect(result.version).to.equal('1.0.0');
    });

    it('should throw if package.json missing', () => {
      const emptyDir = path.join(testDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });

      expect(() => ModuleManifest.readManifest(emptyDir)).to.throw('Missing package.json');
    });

    it('should merge antelope.module.json if present', () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
      };
      const moduleJson = {
        imports: ['core@beta'],
        importsOptional: [],
      };

      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));
      fs.writeFileSync(path.join(testDir, 'antelope.module.json'), JSON.stringify(moduleJson));

      const result = ModuleManifest.readManifest(testDir);

      expect(result.antelopeJs?.imports).to.deep.equal(['core@beta']);
    });
  });

  describe('ModuleManifest constructor', () => {
    it('should create manifest with folder and source', () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');

      expect(manifest.name).to.equal('test-module');
      expect(manifest.version).to.equal('1.0.0');
      expect(manifest.folder).to.include(testDir);
    });

    it('should parse imports from antelopeJs config', () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: ['core@beta', 'logging@beta'],
          importsOptional: [],
        },
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');

      expect(manifest.imports).to.deep.equal(['core@beta', 'logging@beta']);
    });

    it('should use default exportsPath', () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');

      expect(manifest.exportsPath).to.include('interfaces');
    });

    it('should use custom exportsPath', () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exportsPath: 'custom/exports',
        },
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');

      expect(manifest.exportsPath).to.include('custom/exports');
    });

    it('should parse paths configuration', () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          paths: {
            '@src/*': ['src/*'],
          },
        },
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');

      expect(manifest.paths).to.be.an('array');
      expect(manifest.paths.length).to.be.greaterThan(0);
    });

    it('should parse srcAliases from _moduleAliases', () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
        _moduleAliases: {
          '@src': 'dist',
        },
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');

      expect(manifest.srcAliases).to.be.an('array');
      expect(manifest.srcAliases?.length).to.be.greaterThan(0);
      expect(manifest.srcAliases?.[0].alias).to.equal('@src');
    });

    it('should parse srcAliases from antelopeJs.moduleAliases', () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          moduleAliases: {
            '@utils': 'src/utils',
          },
        },
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');

      expect(manifest.srcAliases).to.be.an('array');
      expect(manifest.srcAliases?.some((a) => a.alias === '@utils')).to.be.true;
    });

    it('should merge _moduleAliases and antelopeJs.moduleAliases', () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
        _moduleAliases: {
          '@legacy': 'legacy',
        },
        antelopeJs: {
          imports: [],
          importsOptional: [],
          moduleAliases: {
            '@new': 'new',
          },
        },
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');

      expect(manifest.srcAliases?.length).to.equal(2);
    });

    it('should handle source with main property', () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const manifest = new ModuleManifest(testDir, { type: 'local', main: 'src/index.js' } as any, 'test-module');

      expect(manifest.main).to.include('src/index.js');
    });
  });

  describe('ModuleManifest.loadExports', () => {
    it('should load exports from directory', async () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      // Create interfaces directory structure
      const interfacesDir = path.join(testDir, 'interfaces');
      const coreDir = path.join(interfacesDir, 'core');
      fs.mkdirSync(coreDir, { recursive: true });
      fs.writeFileSync(path.join(coreDir, 'beta.js'), 'module.exports = {}');

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');
      await manifest.loadExports();

      expect(manifest.exports).to.have.property('core@beta');
    });

    it('should handle explicit exports config', async () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exports: ['logging@beta'],
        },
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      // Create the export path
      const loggingDir = path.join(testDir, 'interfaces', 'logging');
      fs.mkdirSync(loggingDir, { recursive: true });
      fs.writeFileSync(path.join(loggingDir, 'beta.js'), 'module.exports = {}');

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');
      await manifest.loadExports();

      expect(manifest.exports).to.have.property('logging@beta');
    });

    it('should handle non-existent interfaces directory', async () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');
      await manifest.loadExports();

      expect(manifest.exports).to.deep.equal({});
    });
  });

  describe('ModuleManifest.reload', () => {
    it('should reload manifest from disk', async () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');
      expect(manifest.version).to.equal('1.0.0');

      // Update the package.json
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({ ...packageJson, version: '2.0.0' }),
      );

      await manifest.reload();

      expect(manifest.version).to.equal('2.0.0');
    });

    it('should update imports on reload', async () => {
      const packageJson = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: ['core@beta'],
          importsOptional: [],
        },
      };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(packageJson));

      const manifest = new ModuleManifest(testDir, { type: 'local' } as any, 'test-module');
      expect(manifest.imports).to.deep.equal(['core@beta']);

      // Update the package.json with new imports
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({
          ...packageJson,
          antelopeJs: { imports: ['core@beta', 'logging@beta'], importsOptional: [] },
        }),
      );

      await manifest.reload();

      expect(manifest.imports).to.include('logging@beta');
    });
  });
});
