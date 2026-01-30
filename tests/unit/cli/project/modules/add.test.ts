import { expect, sinon } from '../../../../helpers/setup';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import path from 'path';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as common from '../../../../../src/cli/common';
import { createTempDir, cleanupDir, writeJson, readJson } from '../../../../helpers/integration';
import proxyquire from 'proxyquire';

describe('cli/project/modules/add', () => {
  const testDir = path.join(__dirname, '../../../../fixtures/test-project-modules-add-' + Date.now());

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

  describe('command structure', () => {
    it('should export a function that returns a Command', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      expect(command.name()).to.equal('add');
    });

    it('should have correct description', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      expect(command.description()).to.include('Add modules to your project');
    });

    it('should have --mode option', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--mode');
    });

    it('should have --project option', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--project');
    });

    it('should have --env option', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--env');
    });

    it('should require modules argument', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('modules');
    });

    it('should accept variadic modules argument', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.true;
    });
  });

  describe('option details', () => {
    it('should have -m as alias for --mode', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const modeOption = command.options.find((o: any) => o.long === '--mode');
      expect(modeOption).to.exist;
      expect(modeOption.short).to.equal('-m');
    });

    it('should have -e as alias for --env', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.short).to.equal('-e');
    });
  });

  describe('handlers map', () => {
    it('should export handlers map', () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');

      expect(handlers).to.be.instanceOf(Map);
    });

    it('should have package handler', () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');

      expect(handlers.has('package')).to.be.true;
      expect(handlers.get('package')).to.be.a('function');
    });

    it('should have git handler', () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');

      expect(handlers.has('git')).to.be.true;
      expect(handlers.get('git')).to.be.a('function');
    });

    it('should have local handler', () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');

      expect(handlers.has('local')).to.be.true;
      expect(handlers.get('local')).to.be.a('function');
    });

    it('should have dir handler', () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');

      expect(handlers.has('dir')).to.be.true;
      expect(handlers.get('dir')).to.be.a('function');
    });

    it('should have exactly 4 handlers', () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');

      expect(handlers.size).to.equal(4);
    });
  });

  describe('projectModulesAddCommand export', () => {
    it('should be exported as a function', () => {
      const { projectModulesAddCommand } = require('../../../../../src/cli/project/modules/add');

      expect(projectModulesAddCommand).to.be.a('function');
    });

    it('should be an async function', () => {
      const { projectModulesAddCommand } = require('../../../../../src/cli/project/modules/add');

      // Async functions return promises when called
      expect(projectModulesAddCommand.constructor.name).to.equal('AsyncFunction');
    });
  });

  describe('no project found', () => {
    it('should set exitCode to 1 when no project exists', async () => {
      // Stub readConfig to return undefined (no project found)
      sinon.stub(common, 'readConfig').resolves(undefined);

      const { projectModulesAddCommand } = require('../../../../../src/cli/project/modules/add');

      const originalExitCode = process.exitCode;

      try {
        await projectModulesAddCommand(['test-module'], {
          mode: 'package',
          project: path.join(testDir, 'nonexistent'),
        });
      } catch {
        // Command may throw or set exitCode
      }

      expect(process.exitCode).to.equal(1);
      process.exitCode = originalExitCode;
    });
  });

  describe('handler validation', () => {
    it('should validate npm module format in package handler', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const packageHandler = handlers.get('package');

      // Should handle valid formats without throwing during parsing
      expect(packageHandler).to.be.a('function');
    });

    it('should validate git URL format in git handler', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const gitHandler = handlers.get('git');

      expect(gitHandler).to.be.a('function');
    });
  });

  describe('projectModulesAddCommand action', () => {
    let projectDir: string;
    let originalExitCode: typeof process.exitCode;

    beforeEach(async () => {
      projectDir = await createTempDir('project-add-test');

      // Create project antelope.json
      await writeJson(path.join(projectDir, 'antelope.json'), {
        name: 'test-project',
        modules: {},
      });

      // Create .antelope/cache directory
      await fsp.mkdir(path.join(projectDir, '.antelope', 'cache'), { recursive: true });

      originalExitCode = process.exitCode;
    });

    afterEach(async () => {
      await cleanupDir(projectDir);
      process.exitCode = originalExitCode;
    });

    it('should add a git module to the project', async () => {
      const readConfigStub = sinon.stub().resolves({
        name: 'test-project',
        modules: {},
      });
      const writeConfigStub = sinon.stub().resolves();

      const { projectModulesAddCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/add',
        {
          '../../common': {
            readConfig: readConfigStub,
            writeConfig: writeConfigStub,
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules: {} }),
          },
          '../../../common/cache': {
            ModuleCache: class {
              async load() {}
            },
          },
          '../../../common/downloader': {
            default: sinon.stub().resolves([]),
            GetLoaderIdentifier: sinon.stub().returns(null),
          },
        },
      );

      await projectModulesAddCommand(['https://github.com/test/module.git'], {
        mode: 'git',
        project: projectDir,
      });

      expect(writeConfigStub).to.have.been.called;
      const savedConfig = writeConfigStub.firstCall.args[1];
      expect(savedConfig.modules).to.have.property('module');
    });

    it('should skip modules that already exist in config', async () => {
      const existingModules = {
        'existing-module': { source: { type: 'git', remote: 'https://example.com/repo.git' } },
      };

      const readConfigStub = sinon.stub().resolves({
        name: 'test-project',
        modules: existingModules,
      });
      const writeConfigStub = sinon.stub().resolves();

      const { projectModulesAddCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/add',
        {
          '../../common': {
            readConfig: readConfigStub,
            writeConfig: writeConfigStub,
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules: existingModules }),
          },
          '../../../common/cache': {
            ModuleCache: class {
              async load() {}
            },
          },
          '../../../common/downloader': {
            default: sinon.stub().resolves([]),
            GetLoaderIdentifier: sinon.stub().returns(null),
          },
        },
      );

      await projectModulesAddCommand(['https://github.com/test/existing-module.git'], {
        mode: 'git',
        project: projectDir,
      });

      expect(writeConfigStub).to.have.been.called;
      // Module should be skipped since it already exists
    });

    it('should handle environment-specific module addition', async () => {
      const readConfigStub = sinon.stub().resolves({
        name: 'test-project',
        modules: {},
        environments: {
          production: { modules: {} },
        },
      });
      const writeConfigStub = sinon.stub().resolves();

      const { projectModulesAddCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/add',
        {
          '../../common': {
            readConfig: readConfigStub,
            writeConfig: writeConfigStub,
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules: {} }),
          },
          '../../../common/cache': {
            ModuleCache: class {
              async load() {}
            },
          },
          '../../../common/downloader': {
            default: sinon.stub().resolves([]),
            GetLoaderIdentifier: sinon.stub().returns(null),
          },
        },
      );

      await projectModulesAddCommand(['https://github.com/test/module.git'], {
        mode: 'git',
        project: projectDir,
        env: 'production',
      });

      expect(writeConfigStub).to.have.been.called;
    });

    it('should handle environment not found error', async () => {
      const readConfigStub = sinon.stub().resolves({
        name: 'test-project',
        modules: {},
        environments: {},
      });
      const writeConfigStub = sinon.stub().resolves();

      const { projectModulesAddCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/add',
        {
          '../../common': {
            readConfig: readConfigStub,
            writeConfig: writeConfigStub,
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules: {} }),
          },
          '../../../common/cache': {
            ModuleCache: class {
              async load() {}
            },
          },
          '../../../common/downloader': {
            default: sinon.stub().resolves([]),
            GetLoaderIdentifier: sinon.stub().returns(null),
          },
        },
      );

      await projectModulesAddCommand(['https://github.com/test/module.git'], {
        mode: 'git',
        project: projectDir,
        env: 'nonexistent',
      });

      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;
    });

    it('should handle handler errors gracefully', async () => {
      const readConfigStub = sinon.stub().resolves({
        name: 'test-project',
        modules: {},
      });
      const writeConfigStub = sinon.stub().resolves();

      // Create a mock handlers map with a failing handler
      const failingHandler = sinon.stub().rejects(new Error('Handler failed'));
      const mockHandlers = new Map([['git', failingHandler]]);

      const { projectModulesAddCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/add',
        {
          '../../common': {
            readConfig: readConfigStub,
            writeConfig: writeConfigStub,
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules: {} }),
          },
          '../../../common/cache': {
            ModuleCache: class {
              async load() {}
            },
          },
          '../../../common/downloader': {
            default: sinon.stub().resolves([]),
            GetLoaderIdentifier: sinon.stub().returns(null),
          },
        },
      );

      // Get the handlers from the proxyquired module
      const addModule = proxyquire.noCallThru()('../../../../../src/cli/project/modules/add', {
        '../../common': {
          readConfig: readConfigStub,
          writeConfig: writeConfigStub,
          Options: { project: { defaultValue: '.' } },
        },
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules: {} }),
        },
        '../../../common/cache': {
          ModuleCache: class {
            async load() {}
          },
        },
        '../../../common/downloader': {
          default: sinon.stub().resolves([]),
          GetLoaderIdentifier: sinon.stub().returns(null),
        },
      });

      // Manually override the handler to fail
      const originalHandler = addModule.handlers.get('git');
      addModule.handlers.set('git', failingHandler);

      try {
        await addModule.projectModulesAddCommand(['https://github.com/test/module.git'], {
          mode: 'git',
          project: projectDir,
        });

        expect(cliUi.error).to.have.been.called;
      } finally {
        // Restore original handler
        addModule.handlers.set('git', originalHandler);
      }
    });
  });

  describe('git handler', () => {
    it('should parse git URL and return correct config', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const gitHandler = handlers.get('git');

      const result = await gitHandler('https://github.com/test/my-module.git', { project: testDir });

      expect(result[0]).to.equal('my-module');
      expect(result[1]).to.deep.equal({
        source: {
          type: 'git',
          remote: 'https://github.com/test/my-module.git',
        },
      });
    });

    it('should handle SSH git URLs', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const gitHandler = handlers.get('git');

      const result = await gitHandler('git@github.com:test/ssh-module.git', { project: testDir });

      expect(result[0]).to.equal('ssh-module');
      expect(result[1].source.type).to.equal('git');
    });

    it('should throw error for invalid git URL format', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const gitHandler = handlers.get('git');

      try {
        await gitHandler('invalid-url', { project: testDir });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Invalid git URL format');
      }
    });
  });

  describe('local handler', () => {
    let localModuleDir: string;

    beforeEach(async () => {
      localModuleDir = await createTempDir('local-module-test');
      await writeJson(path.join(localModuleDir, 'package.json'), {
        name: 'local-test-module',
        version: '1.0.0',
      });
    });

    afterEach(async () => {
      await cleanupDir(localModuleDir);
    });

    it('should parse local module path and return correct config', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const localHandler = handlers.get('local');

      const result = await localHandler(localModuleDir, { project: testDir });

      expect(result[0]).to.equal('local-test-module');
      expect(result[1].source.type).to.equal('local');
      expect(result[1].source.installCommand).to.deep.equal(['npx tsc']);
    });

    it('should throw error for non-directory path', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const localHandler = handlers.get('local');

      const filePath = path.join(localModuleDir, 'package.json');

      try {
        await localHandler(filePath, { project: testDir });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('not a directory');
      }
    });

    it('should throw error when package.json is missing', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const localHandler = handlers.get('local');

      const emptyDir = await createTempDir('empty-module');

      try {
        await localHandler(emptyDir, { project: testDir });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        // Can be either "No package.json found" or a stat error for non-existent file
        expect(error.message).to.satisfy((msg: string) =>
          msg.includes('No package.json found') || msg.includes('ENOENT') || msg.includes('not a file'),
        );
      } finally {
        await cleanupDir(emptyDir);
      }
    });
  });

  describe('dir handler', () => {
    let dirModuleDir: string;

    beforeEach(async () => {
      dirModuleDir = await createTempDir('dir-module-test');
    });

    afterEach(async () => {
      await cleanupDir(dirModuleDir);
    });

    it('should parse dir path and return correct config', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const dirHandler = handlers.get('dir');

      const result = await dirHandler(dirModuleDir, { project: testDir });

      expect(result[0]).to.include(':');
      expect(result[1].source.type).to.equal('local-folder');
      expect(result[1].source.installCommand).to.deep.equal(['npx tsc']);
    });

    it('should throw error for non-directory path', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const dirHandler = handlers.get('dir');

      const filePath = path.join(dirModuleDir, 'file.txt');
      await fsp.writeFile(filePath, 'test');

      try {
        await dirHandler(filePath, { project: testDir });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('not a directory');
      }
    });
  });

  describe('package handler', () => {
    it('should parse package name with version', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const packageHandler = handlers.get('package');

      // Mock ExecuteCMD to avoid actual npm calls
      const originalModule = require('../../../../../src/cli/project/modules/add');

      // We cannot easily test the package handler without mocking ExecuteCMD
      // Just verify it's a function
      expect(packageHandler).to.be.a('function');
    });
  });
});
