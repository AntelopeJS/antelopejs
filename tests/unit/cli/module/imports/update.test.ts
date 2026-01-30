import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as fsp from 'fs/promises';
import path from 'path';
import { createTempDir, cleanupDir, writeJson, readJson } from '../../../../helpers/integration';
import {
  createMockGitHelpers,
  createMockInterfaceInfo,
  createProxyquireGitModule,
} from '../../../../helpers/mocks/git-helpers.mock';
import proxyquire from 'proxyquire';

describe('cli/module/imports/update', () => {
  beforeEach(() => {
    // Stub CLI UI functions to avoid console output during tests
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
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      expect(command.name()).to.equal('update');
    });

    it('should have correct description', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      expect(command.description()).to.include('Update module imports');
    });

    it('should have --module option', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });

    it('should have --dry-run option', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--dry-run');
    });

    it('should have --skip-install option', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--skip-install');
    });

    it('should have -s as alias for --skip-install', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const skipInstallOption = command.options.find((o: any) => o.long === '--skip-install');
      expect(skipInstallOption).to.exist;
      expect(skipInstallOption.short).to.equal('-s');
    });
  });

  describe('option defaults', () => {
    it('should have --dry-run default to false', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const dryRunOption = command.options.find((o: any) => o.long === '--dry-run');
      expect(dryRunOption).to.exist;
      expect(dryRunOption.defaultValue).to.equal(false);
    });

    it('should have --skip-install default to false', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const skipInstallOption = command.options.find((o: any) => o.long === '--skip-install');
      expect(skipInstallOption).to.exist;
      expect(skipInstallOption.defaultValue).to.equal(false);
    });
  });

  describe('interfaces argument', () => {
    it('should accept optional interfaces argument', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('interfaces');
    });

    it('should have variadic interfaces argument', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.true;
    });

    it('should have optional interfaces argument (not required)', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const args = command.registeredArguments;
      expect(args[0].required).to.be.false;
    });
  });

  describe('description details', () => {
    it('should mention updating in description', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      expect(command.description()).to.include('Update');
    });

    it('should mention interface definitions in description', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      expect(command.description()).to.include('interface definitions');
    });
  });

  describe('command action', () => {
    it('should have an action handler', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      expect(command._actionHandler).to.exist;
    });
  });

  describe('moduleImportUpdateCommand export', () => {
    it('should be exported as a function', () => {
      const { moduleImportUpdateCommand } = require('../../../../../src/cli/module/imports/update');

      expect(moduleImportUpdateCommand).to.be.a('function');
    });

    it('should be an async function', () => {
      const { moduleImportUpdateCommand } = require('../../../../../src/cli/module/imports/update');

      expect(moduleImportUpdateCommand.constructor.name).to.equal('AsyncFunction');
    });
  });

  describe('moduleImportUpdateCommand action', () => {
    let testDir: string;
    let modulePath: string;
    let originalExitCode: typeof process.exitCode;
    let progressBarStartStub: sinon.SinonStub;
    let progressBarUpdateStub: sinon.SinonStub;
    let progressBarStopStub: sinon.SinonStub;

    beforeEach(async () => {
      testDir = await createTempDir('import-update-test');
      modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      // Create a valid module with package.json and existing imports
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta'],
          importsOptional: [],
        },
      });

      originalExitCode = process.exitCode;

      // Stub ProgressBar methods
      progressBarStartStub = sinon.stub(cliUi.ProgressBar.prototype, 'start');
      progressBarUpdateStub = sinon.stub(cliUi.ProgressBar.prototype, 'update');
      progressBarStopStub = sinon.stub(cliUi.ProgressBar.prototype, 'stop');
    });

    afterEach(async () => {
      await cleanupDir(testDir);
      process.exitCode = originalExitCode;
      // Note: sinon.restore() is called by the parent afterEach
    });

    it('should update interface to newer version', async () => {
      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta', '1.0', '2.0']);

      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
      });
      mockGitHelpers.installInterfaces.resolves();
      mockGitHelpers.removeInterface.resolves();
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      // Verify interface was updated (removeInterface and installInterfaces called)
      expect(mockGitHelpers.removeInterface).to.have.been.called;
      expect(mockGitHelpers.installInterfaces).to.have.been.called;
      expect(mockGitHelpers.createAjsSymlinks).to.have.been.calledWith(modulePath);
      expect(cliUi.success).to.have.been.called;
    });

    it('should handle interface with no newer version', async () => {
      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta']);

      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
      });
      mockGitHelpers.installInterfaces.resolves();
      mockGitHelpers.removeInterface.resolves();
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      // Should still show success message for updating even if same version
      expect(cliUi.success).to.have.been.called;
    });

    it('should handle missing interface', async () => {
      const mockGitHelpers = createMockGitHelpers();

      // Return empty object - interface not found in git
      mockGitHelpers.loadInterfacesFromGit.resolves({});
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      // Should show error about interface not found
      expect(cliUi.error).to.have.been.called;
      expect(cliUi.warning).to.have.been.called; // Warning about failed interfaces
    });

    it('should handle missing module', async () => {
      const emptyDir = path.join(testDir, 'empty');
      await fsp.mkdir(emptyDir, { recursive: true });

      const mockGitHelpers = createMockGitHelpers();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: sinon.stub().resolves(undefined),
            writeModuleManifest: sinon.stub().resolves(),
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: emptyDir,
        dryRun: false,
        skipInstall: false,
      });

      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;
    });

    it('should update dependencies automatically', async () => {
      // Create module with both required and optional imports
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta'],
          importsOptional: ['cache@1.0'],
        },
      });

      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta']);
      const mockCacheInterface = createMockInterfaceInfo('cache', ['1.0']);

      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
        cache: mockCacheInterface,
      });
      mockGitHelpers.installInterfaces.resolves();
      mockGitHelpers.removeInterface.resolves();
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      // Both interfaces should be updated
      expect(mockGitHelpers.removeInterface).to.have.been.calledTwice;
      expect(mockGitHelpers.installInterfaces).to.have.been.called;
      expect(cliUi.success).to.have.been.called;
    });

    it('should update all interfaces when no specific interface given', async () => {
      // Create module with multiple imports
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta', 'database@1.0'],
          importsOptional: [],
        },
      });

      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta', '1.0']);
      const mockDatabaseInterface = createMockInterfaceInfo('database', ['1.0', '2.0']);

      // Track which interfaces were processed
      const processedInterfaces: string[] = [];
      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
        database: mockDatabaseInterface,
      });
      mockGitHelpers.removeInterface.callsFake(async (_module: string, name: string) => {
        processedInterfaces.push(name);
      });
      mockGitHelpers.installInterfaces.resolves();
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      // No specific interfaces - should update all
      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      // Both interfaces should be processed
      expect(processedInterfaces).to.include('logging');
      expect(processedInterfaces).to.include('database');
      expect(cliUi.success).to.have.been.called;
    });

    it('should update only specified interfaces when given', async () => {
      // Create module with multiple imports
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta', 'database@1.0'],
          importsOptional: [],
        },
      });

      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta', '1.0']);

      // Track which interfaces were processed
      const processedInterfaces: string[] = [];
      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
      });
      mockGitHelpers.removeInterface.callsFake(async (_module: string, name: string) => {
        processedInterfaces.push(name);
      });
      mockGitHelpers.installInterfaces.resolves();
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      // Only update logging
      await moduleImportUpdateCommand(['logging'], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      // Only logging should be processed
      expect(processedInterfaces).to.include('logging');
      expect(processedInterfaces).to.not.include('database');
    });

    it('should handle dry-run mode without making changes', async () => {
      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta', '1.0']);

      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
      });
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: true,
        skipInstall: false,
      });

      // Should not call remove/install in dry-run mode
      expect(mockGitHelpers.removeInterface).to.not.have.been.called;
      expect(mockGitHelpers.installInterfaces).to.not.have.been.called;
      expect(mockGitHelpers.createAjsSymlinks).to.not.have.been.called;
      // Should show warning about dry-run
      expect(cliUi.warning).to.have.been.called;
    });

    it('should handle skip-install option', async () => {
      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta']);

      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
      });
      mockGitHelpers.createAjsSymlinks.resolves();

      const writeManifestStub = sinon.stub().resolves();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: writeManifestStub,
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: false,
        skipInstall: true,
      });

      // Should not call remove/install when skip-install is true
      expect(mockGitHelpers.removeInterface).to.not.have.been.called;
      expect(mockGitHelpers.installInterfaces).to.not.have.been.called;
      // Should still save manifest and create symlinks
      expect(writeManifestStub).to.have.been.called;
      expect(mockGitHelpers.createAjsSymlinks).to.have.been.called;
    });

    it('should handle version not found', async () => {
      const mockGitHelpers = createMockGitHelpers();
      // Interface exists but version doesn't match
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['1.0', '2.0']); // No 'beta' version

      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
      });
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      // Should show warning about version not found
      expect(cliUi.warning).to.have.been.called;
    });

    it('should handle module with no imports', async () => {
      // Create module with no imports
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [],
          importsOptional: [],
        },
      });

      const mockGitHelpers = createMockGitHelpers();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      // Should show error about no imports
      expect(cliUi.error).to.have.been.called;
    });

    it('should handle specified interface not found in module', async () => {
      const mockGitHelpers = createMockGitHelpers();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      // Try to update an interface that's not in the module
      await moduleImportUpdateCommand(['nonexistent'], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      // Should show error about interface not found in module
      expect(cliUi.error).to.have.been.called;
    });

    it('should handle module without antelopeJs section', async () => {
      // Create module without antelopeJs section
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
      });

      const mockGitHelpers = createMockGitHelpers();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      // Should show error about no imports found
      expect(cliUi.error).to.have.been.called;
    });

    it('should handle malformed interface name', async () => {
      // Create module with malformed interface name (missing version)
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging'], // No version
          importsOptional: [],
        },
      });

      const mockGitHelpers = createMockGitHelpers();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;
    });

    it('should handle interfaces from different git repositories', async () => {
      // Create module with imports from different git repos
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [
            'logging@beta',
            { name: 'custom@1.0', git: 'https://github.com/custom/interfaces.git' },
          ],
          importsOptional: [],
        },
      });

      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta']);
      const mockCustomInterface = createMockInterfaceInfo('custom', ['1.0']);

      mockGitHelpers.loadInterfacesFromGit.callsFake(async (git: string) => {
        if (git === 'https://github.com/test/interfaces.git') {
          return { logging: mockLoggingInterface };
        } else {
          return { custom: mockCustomInterface };
        }
      });
      mockGitHelpers.installInterfaces.resolves();
      mockGitHelpers.removeInterface.resolves();
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      // Should have called loadInterfacesFromGit twice - once for each git repo
      expect(mockGitHelpers.loadInterfacesFromGit).to.have.been.calledTwice;
      // Should have called installInterfaces twice - once for each git repo
      expect(mockGitHelpers.installInterfaces).to.have.been.calledTwice;
    });

    it('should handle interface with skipInstall flag in manifest', async () => {
      // Create module with skipInstall interface
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [{ name: 'logging@beta', skipInstall: true }],
          importsOptional: [],
        },
      });

      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta']);

      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
      });
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportUpdateCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/update',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportUpdateCommand([], {
        module: modulePath,
        dryRun: false,
        skipInstall: false,
      });

      // Should not call remove/install for skipInstall interface
      expect(mockGitHelpers.removeInterface).to.not.have.been.called;
      expect(mockGitHelpers.installInterfaces).to.not.have.been.called;
      // Should still show success
      expect(cliUi.success).to.have.been.called;
    });
  });
});
