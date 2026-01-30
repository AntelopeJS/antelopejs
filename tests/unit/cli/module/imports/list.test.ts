import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as fsp from 'fs/promises';
import path from 'path';
import { createTempDir, cleanupDir, writeJson, readJson } from '../../../../helpers/integration';
import proxyquire from 'proxyquire';

describe('cli/module/imports/list', () => {
  beforeEach(() => {
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('command structure', () => {
    it('should export a function that returns a Command', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      expect(command.name()).to.equal('list');
    });

    it('should have correct description', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      expect(command.description()).to.include('List all imports');
    });

    it('should have ls alias', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      expect(command.aliases()).to.include('ls');
    });

    it('should have --module option', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });

    it('should have --verbose option', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--verbose');
    });

    it('should have -v as alias for --verbose', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      const verboseOption = command.options.find((o: any) => o.long === '--verbose');
      expect(verboseOption).to.exist;
      expect(verboseOption.short).to.equal('-v');
    });
  });

  describe('option defaults', () => {
    it('should have --verbose default to false', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      const verboseOption = command.options.find((o: any) => o.long === '--verbose');
      expect(verboseOption).to.exist;
      expect(verboseOption.defaultValue).to.equal(false);
    });
  });

  describe('command does not take arguments', () => {
    it('should not have any required arguments', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      const args = command.registeredArguments;
      expect(args.length).to.equal(0);
    });
  });

  describe('moduleImportListCommand export', () => {
    it('should be exported as a function', () => {
      const { moduleImportListCommand } = require('../../../../../src/cli/module/imports/list');

      expect(moduleImportListCommand).to.be.a('function');
    });

    it('should be an async function', () => {
      const { moduleImportListCommand } = require('../../../../../src/cli/module/imports/list');

      expect(moduleImportListCommand.constructor.name).to.equal('AsyncFunction');
    });
  });

  describe('moduleImportListCommand action', () => {
    let testDir: string;
    let modulePath: string;
    let originalExitCode: typeof process.exitCode;

    beforeEach(async () => {
      testDir = await createTempDir('import-list-test');
      modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      originalExitCode = process.exitCode;
    });

    afterEach(async () => {
      await cleanupDir(testDir);
      process.exitCode = originalExitCode;
      // Note: sinon.restore() is called by the parent afterEach
    });

    it('should list imports from valid module', async () => {
      // Create a valid module with package.json containing imports
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta', 'database@1.0'],
          importsOptional: [],
        },
      });

      const { moduleImportListCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/list',
        {
          '../../common': {
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            readConfig: sinon.stub().resolves(undefined),
            Options: { module: {} },
          },
        },
      );

      await moduleImportListCommand({
        module: modulePath,
        verbose: false,
      });

      // Should call displayBox with content containing imports
      expect(cliUi.displayBox).to.have.been.called;
      const displayBoxCall = (cliUi.displayBox as sinon.SinonStub).getCall(0);
      const content = displayBoxCall.args[0];
      expect(content).to.include('logging@beta');
      expect(content).to.include('database@1.0');
    });

    it('should list when no imports exist', async () => {
      // Create a valid module with package.json without imports
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [],
          importsOptional: [],
        },
      });

      const { moduleImportListCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/list',
        {
          '../../common': {
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            readConfig: sinon.stub().resolves(undefined),
            Options: { module: {} },
          },
        },
      );

      await moduleImportListCommand({
        module: modulePath,
        verbose: false,
      });

      // Should call displayBox with content showing no imports
      expect(cliUi.displayBox).to.have.been.called;
      const displayBoxCall = (cliUi.displayBox as sinon.SinonStub).getCall(0);
      const content = displayBoxCall.args[0];
      expect(content).to.include('No required imports defined');
      expect(content).to.include('No optional imports defined');
    });

    it('should handle missing package.json', async () => {
      const emptyDir = path.join(testDir, 'empty');
      await fsp.mkdir(emptyDir, { recursive: true });

      const { moduleImportListCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/list',
        {
          '../../common': {
            readModuleManifest: sinon.stub().resolves(undefined),
            readConfig: sinon.stub().resolves(undefined),
            Options: { module: {} },
          },
        },
      );

      await moduleImportListCommand({
        module: emptyDir,
        verbose: false,
      });

      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;
    });

    it('should handle module without antelopeJs section', async () => {
      // Create a valid package.json without antelopeJs section
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
      });

      const { moduleImportListCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/list',
        {
          '../../common': {
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            readConfig: sinon.stub().resolves(undefined),
            Options: { module: {} },
          },
        },
      );

      await moduleImportListCommand({
        module: modulePath,
        verbose: false,
      });

      expect(process.exitCode).to.equal(1);
      expect(cliUi.warning).to.have.been.called;
    });

    it('should list optional imports separately', async () => {
      // Create a valid module with package.json containing both required and optional imports
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta'],
          importsOptional: ['cache@1.0', 'analytics@beta'],
        },
      });

      const { moduleImportListCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/list',
        {
          '../../common': {
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            readConfig: sinon.stub().resolves(undefined),
            Options: { module: {} },
          },
        },
      );

      await moduleImportListCommand({
        module: modulePath,
        verbose: false,
      });

      // Should call displayBox with content containing both required and optional imports
      expect(cliUi.displayBox).to.have.been.called;
      const displayBoxCall = (cliUi.displayBox as sinon.SinonStub).getCall(0);
      const content = displayBoxCall.args[0];

      // Required imports section
      expect(content).to.include('Required Imports:');
      expect(content).to.include('logging@beta');

      // Optional imports section
      expect(content).to.include('Optional Imports:');
      expect(content).to.include('cache@1.0');
      expect(content).to.include('analytics@beta');
    });

    it('should show verbose information when verbose flag is set', async () => {
      // Create a valid module with package.json containing imports
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta'],
          importsOptional: [],
        },
      });

      // Create antelope.json with import overrides
      await writeJson(path.join(testDir, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'test-module': {
            source: { type: 'local', path: './module' },
            importOverrides: [
              { interface: 'logging@beta', source: './custom-logging' },
            ],
          },
        },
      });

      const { moduleImportListCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/list',
        {
          '../../common': {
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            readConfig: async () => {
              return readJson(path.join(testDir, 'antelope.json'));
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportListCommand({
        module: modulePath,
        verbose: true,
      });

      // Should call displayBox with content containing import and override info
      expect(cliUi.displayBox).to.have.been.called;
      const displayBoxCall = (cliUi.displayBox as sinon.SinonStub).getCall(0);
      const content = displayBoxCall.args[0];
      expect(content).to.include('logging@beta');
      expect(content).to.include('Overridden:');
      expect(content).to.include('./custom-logging');
    });

    it('should handle imports as objects with git source', async () => {
      // Create a valid module with package.json containing import objects
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [
            { name: 'logging@beta', git: 'https://github.com/custom/interfaces.git' },
          ],
          importsOptional: [],
        },
      });

      const { moduleImportListCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/list',
        {
          '../../common': {
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            readConfig: sinon.stub().resolves(undefined),
            Options: { module: {} },
          },
        },
      );

      await moduleImportListCommand({
        module: modulePath,
        verbose: false,
      });

      // Should call displayBox with content containing import and git source
      expect(cliUi.displayBox).to.have.been.called;
      const displayBoxCall = (cliUi.displayBox as sinon.SinonStub).getCall(0);
      const content = displayBoxCall.args[0];
      expect(content).to.include('logging@beta');
      expect(content).to.include('https://github.com/custom/interfaces.git');
    });

    it('should handle imports with skipInstall flag', async () => {
      // Create a valid module with package.json containing import with skipInstall
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [
            { name: 'logging@beta', skipInstall: true },
          ],
          importsOptional: [],
        },
      });

      const { moduleImportListCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/list',
        {
          '../../common': {
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            readConfig: sinon.stub().resolves(undefined),
            Options: { module: {} },
          },
        },
      );

      await moduleImportListCommand({
        module: modulePath,
        verbose: false,
      });

      // Should call displayBox with content containing import and skip-install flag
      expect(cliUi.displayBox).to.have.been.called;
      const displayBoxCall = (cliUi.displayBox as sinon.SinonStub).getCall(0);
      const content = displayBoxCall.args[0];
      expect(content).to.include('logging@beta');
      expect(content).to.include('[skip-install]');
    });
  });
});
