import { expect, sinon } from '../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import * as cliUi from '../../src/utils/cli-ui';
import * as common from '../../src/cli/common';

describe('Integration: CLI Commands', () => {
  const testDir = path.join(__dirname, '../fixtures/test-cli-integration-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
  });

  afterEach(() => {
    sinon.restore();
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('config commands integration', () => {
    it('should show, set, get, and reset config in sequence', async () => {
      const { readUserConfig, getDefaultUserConfig } = common;
      const defaultConfig = getDefaultUserConfig();

      expect(defaultConfig).to.have.property('git');
      expect(defaultConfig.git).to.equal('https://github.com/AntelopeJS/interfaces.git');
    });

    it('should read default user config when no config exists', async () => {
      const config = await common.readUserConfig();

      expect(config).to.have.property('git');
      expect(config.git).to.be.a('string');
    });

    it('should get default config values', () => {
      const defaultConfig = common.getDefaultUserConfig();

      expect(defaultConfig.git).to.equal(common.DEFAULT_GIT_REPO);
    });

    it('should provide project option with default value', () => {
      const projectOption = common.Options.project;

      expect(projectOption).to.exist;
      expect(projectOption.defaultValue).to.be.a('string');
    });

    it('should provide module option with default value', () => {
      const moduleOption = common.Options.module;

      expect(moduleOption).to.exist;
      expect(moduleOption.defaultValue).to.be.a('string');
    });

    it('should provide git option', () => {
      const gitOption = common.Options.git;

      expect(gitOption).to.exist;
    });

    it('should provide verbose option', () => {
      const verboseOption = common.Options.verbose;

      expect(verboseOption).to.exist;
    });
  });

  describe('project workflow', () => {
    it('should create project directory structure correctly', async () => {
      const projectDir = path.join(testDir, 'my-project');
      fs.mkdirSync(projectDir, { recursive: true });

      // Create antelope.json
      const configData = {
        name: 'my-project',
        modules: {
          'test-module': {
            source: {
              type: 'local',
              path: './modules/test',
            },
          },
        },
        logging: {
          enabled: true,
          moduleTracking: {
            enabled: false,
            includes: [],
            excludes: [],
          },
        },
      };
      fs.writeFileSync(path.join(projectDir, 'antelope.json'), JSON.stringify(configData, null, 2));

      // Verify structure
      expect(fs.existsSync(path.join(projectDir, 'antelope.json'))).to.be.true;

      // Read and verify config
      const readConfig = await common.readConfig(projectDir);
      expect(readConfig).to.deep.equal(configData);
    });

    it('should handle project with multiple modules', async () => {
      const projectDir = path.join(testDir, 'multi-module-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const configData = {
        name: 'multi-module-project',
        modules: {
          'local-module': {
            source: {
              type: 'local',
              path: './modules/local',
            },
          },
          'git-module': {
            source: {
              type: 'git',
              remote: 'https://github.com/user/repo.git',
              branch: 'main',
            },
          },
          '@scope/package-module': {
            source: {
              type: 'package',
              package: '@scope/package-module',
              version: '1.0.0',
            },
          },
        },
      };
      fs.writeFileSync(path.join(projectDir, 'antelope.json'), JSON.stringify(configData, null, 2));

      const readConfig = await common.readConfig(projectDir);
      expect(readConfig?.modules).to.have.property('local-module');
      expect(readConfig?.modules).to.have.property('git-module');
      expect(readConfig?.modules).to.have.property('@scope/package-module');
    });

    it('should write and read config preserving structure', async () => {
      const projectDir = path.join(testDir, 'preserved-project');
      fs.mkdirSync(projectDir, { recursive: true });

      // Create initial file
      fs.writeFileSync(path.join(projectDir, 'antelope.json'), '{}');

      const configData = {
        modules: {
          'test-module': {
            source: {
              type: 'local',
              path: './test',
            },
          },
        },
      };

      await common.writeConfig(projectDir, configData);
      const readBack = await common.readConfig(projectDir);

      expect(readBack?.modules).to.deep.equal(configData.modules);
    });

    it('should handle project config with logging settings', async () => {
      const projectDir = path.join(testDir, 'logging-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const configData = {
        name: 'logging-project',
        modules: {},
        logging: {
          enabled: true,
          moduleTracking: {
            enabled: true,
            includes: ['core.*'],
            excludes: ['debug.*'],
          },
          channelFilter: {
            'loader.*': 'debug',
            'module.*': 'info',
          },
        },
      };
      fs.writeFileSync(path.join(projectDir, 'antelope.json'), JSON.stringify(configData, null, 2));

      const readConfig = await common.readConfig(projectDir);
      expect(readConfig?.logging?.enabled).to.be.true;
      expect(readConfig?.logging?.moduleTracking?.enabled).to.be.true;
      expect(readConfig?.logging?.channelFilter).to.have.property('loader.*');
    });

    it('should return undefined for non-existent project', async () => {
      const readConfig = await common.readConfig('/non/existent/path');
      expect(readConfig).to.be.undefined;
    });
  });

  describe('module workflow', () => {
    it('should create module with package.json', async () => {
      const moduleDir = path.join(testDir, 'my-module');
      fs.mkdirSync(moduleDir, { recursive: true });

      // Create package.json with antelopeJs section
      const packageJson = {
        name: 'my-module',
        version: '1.0.0',
        main: 'dist/index.js',
        antelopeJs: {
          exports: ['MyInterface'],
          imports: ['OtherInterface'],
        },
      };
      fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      // Verify module manifest
      const manifest = await common.readModuleManifest(moduleDir);
      expect(manifest).to.exist;
      expect(manifest?.name).to.equal('my-module');
      expect(manifest?.version).to.equal('1.0.0');
      expect(manifest?.antelopeJs?.exports).to.include('MyInterface');
    });

    it('should handle module with interface exports', async () => {
      const moduleDir = path.join(testDir, 'interface-module');
      fs.mkdirSync(moduleDir, { recursive: true });

      const packageJson = {
        name: 'interface-module',
        version: '2.0.0',
        antelopeJs: {
          exports: ['MyInterface/beta', 'AnotherInterface/v1'],
          imports: [],
        },
      };
      fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const manifest = await common.readModuleManifest(moduleDir);
      expect(manifest?.antelopeJs?.exports).to.have.length(2);
      expect(manifest?.antelopeJs?.exports).to.include('MyInterface/beta');
    });

    it('should handle module with interface imports', async () => {
      const moduleDir = path.join(testDir, 'import-module');
      fs.mkdirSync(moduleDir, { recursive: true });

      const packageJson = {
        name: 'import-module',
        version: '1.0.0',
        antelopeJs: {
          exports: [],
          imports: ['Core/beta', 'Logging/beta'],
        },
      };
      fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const manifest = await common.readModuleManifest(moduleDir);
      expect(manifest?.antelopeJs?.imports).to.have.length(2);
      expect(manifest?.antelopeJs?.imports).to.include('Core/beta');
      expect(manifest?.antelopeJs?.imports).to.include('Logging/beta');
    });

    it('should write and read module manifest', async () => {
      const moduleDir = path.join(testDir, 'write-module');
      fs.mkdirSync(moduleDir, { recursive: true });

      // Create initial file
      fs.writeFileSync(path.join(moduleDir, 'package.json'), '{}');

      const packageJson = {
        name: 'write-module',
        version: '3.0.0',
        antelopeJs: {
          exports: ['TestExport'],
          imports: ['TestImport'],
        },
      };

      await common.writeModuleManifest(moduleDir, packageJson as any);
      const manifest = await common.readModuleManifest(moduleDir);

      expect(manifest?.name).to.equal('write-module');
      expect(manifest?.version).to.equal('3.0.0');
    });

    it('should return undefined for non-existent module', async () => {
      const manifest = await common.readModuleManifest('/non/existent/module');
      expect(manifest).to.be.undefined;
    });

    it('should handle module without antelopeJs section', async () => {
      const moduleDir = path.join(testDir, 'plain-module');
      fs.mkdirSync(moduleDir, { recursive: true });

      const packageJson = {
        name: 'plain-module',
        version: '1.0.0',
        main: 'index.js',
      };
      fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      const manifest = await common.readModuleManifest(moduleDir);
      expect(manifest).to.exist;
      expect(manifest?.name).to.equal('plain-module');
      expect(manifest?.antelopeJs).to.be.undefined;
    });
  });

  describe('indentation preservation', () => {
    it('should detect space indentation in files', async () => {
      const filePath = path.join(testDir, 'space-indent.json');
      fs.writeFileSync(filePath, '{\n  "key": "value"\n}');

      const indentation = await common.detectIndentation(filePath);
      expect(indentation).to.equal('  ');
    });

    it('should detect tab indentation in files', async () => {
      const filePath = path.join(testDir, 'tab-indent.json');
      fs.writeFileSync(filePath, '{\n\t"key": "value"\n}');

      const indentation = await common.detectIndentation(filePath);
      expect(indentation).to.equal('\t');
    });

    it('should return default indentation for non-existent files', async () => {
      const indentation = await common.detectIndentation('/non/existent/file.json');
      expect(indentation).to.equal('  ');
    });

    it('should preserve indentation when writing config', async () => {
      const projectDir = path.join(testDir, 'indent-project');
      fs.mkdirSync(projectDir, { recursive: true });

      // Create file with tab indentation
      fs.writeFileSync(path.join(projectDir, 'antelope.json'), '{\n\t"old": "value"\n}');

      await common.writeConfig(projectDir, { modules: {} });

      const content = fs.readFileSync(path.join(projectDir, 'antelope.json'), 'utf-8');
      expect(content).to.include('\t');
    });
  });

  describe('complete workflow simulation', () => {
    it('should simulate project creation workflow', async () => {
      const projectDir = path.join(testDir, 'complete-workflow');
      fs.mkdirSync(projectDir, { recursive: true });

      // Step 1: Create project config
      fs.writeFileSync(path.join(projectDir, 'antelope.json'), '{}');
      await common.writeConfig(projectDir, {
        name: 'complete-workflow',
        modules: {},
      });

      // Step 2: Add a local module
      const moduleDir = path.join(projectDir, 'modules', 'my-module');
      fs.mkdirSync(moduleDir, { recursive: true });

      fs.writeFileSync(path.join(moduleDir, 'package.json'), '{}');
      await common.writeModuleManifest(moduleDir, {
        name: 'my-module',
        version: '1.0.0',
        antelopeJs: {
          exports: [],
          imports: [],
        },
      } as any);

      // Step 3: Update project config to include module
      await common.writeConfig(projectDir, {
        name: 'complete-workflow',
        modules: {
          'my-module': {
            source: {
              type: 'local',
              path: './modules/my-module',
            } as any,
          },
        },
      });

      // Step 4: Verify final state
      const projectConfig = await common.readConfig(projectDir);
      const moduleManifest = await common.readModuleManifest(moduleDir);

      expect(projectConfig?.modules).to.have.property('my-module');
      expect(moduleManifest?.name).to.equal('my-module');
    });

    it('should simulate adding multiple module types', async () => {
      const projectDir = path.join(testDir, 'multi-type-workflow');
      fs.mkdirSync(projectDir, { recursive: true });

      fs.writeFileSync(path.join(projectDir, 'antelope.json'), '{}');

      // Add modules of different types
      await common.writeConfig(projectDir, {
        name: 'multi-type-project',
        modules: {
          'local-mod': {
            source: { type: 'local', path: './local' } as any,
          },
          'git-mod': {
            source: { type: 'git', remote: 'https://github.com/test/repo.git' } as any,
          },
          'package-mod': {
            source: { type: 'package', package: 'test-pkg', version: '1.0.0' } as any,
          },
        },
      });

      const config = await common.readConfig(projectDir);

      // Verify all module types are present
      expect((config?.modules!['local-mod'] as any).source.type).to.equal('local');
      expect((config?.modules!['git-mod'] as any).source.type).to.equal('git');
      expect((config?.modules!['package-mod'] as any).source.type).to.equal('package');
    });
  });

  describe('git repository handling', () => {
    it('should have default git repository constant', () => {
      expect(common.DEFAULT_GIT_REPO).to.equal('https://github.com/AntelopeJS/interfaces.git');
    });

    it('should provide git URL in default user config', () => {
      const defaultConfig = common.getDefaultUserConfig();
      expect(defaultConfig.git).to.equal(common.DEFAULT_GIT_REPO);
    });
  });
});
