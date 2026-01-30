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

describe('cli/module/imports/install', () => {
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
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      expect(command.name()).to.equal('install');
    });

    it('should have correct description', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      expect(command.description()).to.include('Install missing interfaces');
    });

    it('should have --module option', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });
  });

  describe('option configuration', () => {
    it('should have module option with default value', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.defaultValue).to.exist;
    });

    it('should have module option with argument parser', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.argChoices).to.be.undefined; // Not using choices
    });
  });

  describe('command action', () => {
    it('should have an action handler', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      // Commander stores action handlers internally
      expect(command._actionHandler).to.exist;
    });
  });

  describe('description details', () => {
    it('should mention .antelope directory in description', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      expect(command.description()).to.include('.antelope');
    });

    it('should mention package.json in description', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      expect(command.description()).to.include('package.json');
    });

    it('should mention interfaces.d in description', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      expect(command.description()).to.include('interfaces.d');
    });
  });

  describe('argument configuration', () => {
    it('should have optional interface argument', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      const args = command.registeredArguments;
      expect(args.length).to.equal(1);
      expect(args[0].name()).to.equal('interface');
      expect(args[0].required).to.be.false;
    });
  });

  describe('moduleImportInstallCommand export', () => {
    it('should be exported as a function', () => {
      const { moduleImportInstallCommand } = require('../../../../../src/cli/module/imports/install');

      expect(moduleImportInstallCommand).to.be.a('function');
    });

    it('should be an async function', () => {
      const { moduleImportInstallCommand } = require('../../../../../src/cli/module/imports/install');

      expect(moduleImportInstallCommand.constructor.name).to.equal('AsyncFunction');
    });
  });

  describe('moduleImportInstallCommand action', () => {
    let testDir: string;
    let modulePath: string;
    let originalExitCode: typeof process.exitCode;
    let progressBarStartStub: sinon.SinonStub;
    let progressBarUpdateStub: sinon.SinonStub;
    let progressBarStopStub: sinon.SinonStub;

    beforeEach(async () => {
      testDir = await createTempDir('import-install-test');
      modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      // Create a valid module with package.json
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

    it('should install interfaces from manifest', async () => {
      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta', '1.0']);

      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
      });
      mockGitHelpers.installInterfaces.resolves();
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportInstallCommand(undefined, {
        module: modulePath,
      });

      expect(mockGitHelpers.installInterfaces).to.have.been.called;
      expect(cliUi.success).to.have.been.called;
    });

    it('should handle empty imports array', async () => {
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
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportInstallCommand(undefined, {
        module: modulePath,
      });

      // Should show info message about no interfaces
      expect(cliUi.info).to.have.been.called;
      expect(mockGitHelpers.installInterfaces).to.not.have.been.called;
    });

    it('should handle missing module', async () => {
      const emptyDir = path.join(testDir, 'empty');
      await fsp.mkdir(emptyDir, { recursive: true });

      const mockGitHelpers = createMockGitHelpers();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: sinon.stub().resolves(undefined),
            Options: { module: {} },
          },
        },
      );

      await moduleImportInstallCommand(undefined, {
        module: emptyDir,
      });

      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;
    });

    it('should install both required and optional imports', async () => {
      // Create module with both required and optional imports
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta'],
          importsOptional: ['cache@beta'],
        },
      });

      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta']);
      const mockCacheInterface = createMockInterfaceInfo('cache', ['beta']);

      // Track all interfaces passed to installInterfaces
      const installedInterfaces: string[] = [];
      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
        cache: mockCacheInterface,
      });
      mockGitHelpers.installInterfaces.callsFake(async (_git: string, _module: string, interfaces: any[]) => {
        interfaces.forEach((i) => installedInterfaces.push(i.interfaceInfo.name));
      });
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportInstallCommand(undefined, {
        module: modulePath,
      });

      expect(mockGitHelpers.installInterfaces).to.have.been.called;
      // Should have installed both interfaces
      expect(installedInterfaces).to.have.lengthOf(2);
      expect(installedInterfaces).to.include('logging');
      expect(installedInterfaces).to.include('cache');
    });

    it('should handle specific interface argument', async () => {
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
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta']);

      // Track all interfaces passed to installInterfaces
      const installedInterfaces: string[] = [];
      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
      });
      mockGitHelpers.installInterfaces.callsFake(async (_git: string, _module: string, interfaces: any[]) => {
        interfaces.forEach((i) => installedInterfaces.push(i.interfaceInfo.name));
      });
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      // Only install logging interface
      await moduleImportInstallCommand('logging@beta', {
        module: modulePath,
      });

      expect(mockGitHelpers.installInterfaces).to.have.been.called;
      // Should have installed only the logging interface
      expect(installedInterfaces).to.have.lengthOf(1);
      expect(installedInterfaces[0]).to.equal('logging');
    });

    it('should handle installInterfaces error', async () => {
      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta']);

      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
      });
      mockGitHelpers.installInterfaces.rejects(new Error('Git clone failed'));
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      try {
        await moduleImportInstallCommand(undefined, {
          module: modulePath,
        });
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect((err as Error).message).to.equal('Git clone failed');
      }
    });

    it('should handle interface not found in git', async () => {
      const mockGitHelpers = createMockGitHelpers();

      // Return empty object - interface not found
      mockGitHelpers.loadInterfacesFromGit.resolves({});
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportInstallCommand(undefined, {
        module: modulePath,
      });

      // Should show warning about failed interfaces
      expect(cliUi.warning).to.have.been.called;
    });

    it('should handle version not found', async () => {
      const mockGitHelpers = createMockGitHelpers();
      // Interface exists but version doesn't match
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['1.0', '2.0']); // No 'beta' version

      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
      });
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportInstallCommand(undefined, {
        module: modulePath,
      });

      // Should show warning about failed interfaces
      expect(cliUi.warning).to.have.been.called;
    });

    it('should skip already installed interfaces', async () => {
      // Create .antelope/interfaces.d/logging/beta directory to simulate installed interface
      const interfacesDir = path.join(modulePath, '.antelope', 'interfaces.d', 'logging', 'beta');
      await fsp.mkdir(interfacesDir, { recursive: true });

      const mockGitHelpers = createMockGitHelpers();
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportInstallCommand(undefined, {
        module: modulePath,
      });

      // Should show success message that all interfaces are already installed
      expect(cliUi.success).to.have.been.called;
      expect(mockGitHelpers.installInterfaces).to.not.have.been.called;
    });

    it('should handle skipInstall flag on imports', async () => {
      // Create module with skipInstall import
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

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportInstallCommand(undefined, {
        module: modulePath,
      });

      // installInterfaces should not be called for skipInstall interface
      expect(mockGitHelpers.installInterfaces).to.not.have.been.called;
      // But should still show success with skip-install note
      expect(cliUi.success).to.have.been.called;
    });

    it('should handle module without antelopeJs section', async () => {
      // Create module without antelopeJs section
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
      });

      const mockGitHelpers = createMockGitHelpers();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportInstallCommand(undefined, {
        module: modulePath,
      });

      expect(process.exitCode).to.equal(1);
      expect(cliUi.warning).to.have.been.called;
    });

    it('should handle interface argument not found in imports', async () => {
      const mockGitHelpers = createMockGitHelpers();
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      // Try to install an interface that's not in package.json
      await moduleImportInstallCommand('nonexistent@beta', {
        module: modulePath,
      });

      expect(cliUi.warning).to.have.been.called;
      expect(mockGitHelpers.installInterfaces).to.not.have.been.called;
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

      mockGitHelpers.loadInterfacesFromGit.callsFake(async (git: string, names: string[]) => {
        if (git === 'https://github.com/test/interfaces.git') {
          return { logging: mockLoggingInterface };
        } else {
          return { custom: mockCustomInterface };
        }
      });
      mockGitHelpers.installInterfaces.resolves();
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportInstallCommand(undefined, {
        module: modulePath,
      });

      // Should have called loadInterfacesFromGit twice - once for each git repo
      expect(mockGitHelpers.loadInterfacesFromGit).to.have.been.calledTwice;
      // Should have called installInterfaces twice - once for each git repo
      expect(mockGitHelpers.installInterfaces).to.have.been.calledTwice;
    });

    it('should create @ajs symlinks after installation', async () => {
      const mockGitHelpers = createMockGitHelpers();
      const mockLoggingInterface = createMockInterfaceInfo('logging', ['beta']);

      mockGitHelpers.loadInterfacesFromGit.resolves({
        logging: mockLoggingInterface,
      });
      mockGitHelpers.installInterfaces.resolves();
      mockGitHelpers.createAjsSymlinks.resolves();

      const { moduleImportInstallCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/install',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            Options: { module: {} },
          },
        },
      );

      await moduleImportInstallCommand(undefined, {
        module: modulePath,
      });

      expect(mockGitHelpers.createAjsSymlinks).to.have.been.calledWith(modulePath);
    });
  });
});
