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

describe('cli/module/imports/add', () => {
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
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      expect(command.name()).to.equal('add');
    });

    it('should have correct description', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      expect(command.description()).to.include('Add interfaces to your module');
    });

    it('should have --module option', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });

    it('should have --git option', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--git');
    });

    it('should have -g as alias for --git', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const gitOption = command.options.find((o: any) => o.long === '--git');
      expect(gitOption).to.exist;
      expect(gitOption.short).to.equal('-g');
    });

    it('should have --optional flag', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--optional');
    });

    it('should have -o as alias for --optional', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const optionalOption = command.options.find((o: any) => o.long === '--optional');
      expect(optionalOption).to.exist;
      expect(optionalOption.short).to.equal('-o');
    });

    it('should have --skip-install flag', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--skip-install');
    });

    it('should have -s as alias for --skip-install', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const skipInstallOption = command.options.find((o: any) => o.long === '--skip-install');
      expect(skipInstallOption).to.exist;
      expect(skipInstallOption.short).to.equal('-s');
    });

    it('should require interfaces argument', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('interfaces');
    });

    it('should accept variadic interfaces argument', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.true;
    });

    it('should have required interfaces argument', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const args = command.registeredArguments;
      expect(args[0].required).to.be.true;
    });
  });

  describe('option defaults', () => {
    it('should have --optional default to false', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const optionalOption = command.options.find((o: any) => o.long === '--optional');
      expect(optionalOption).to.exist;
      expect(optionalOption.defaultValue).to.equal(false);
    });

    it('should have --skip-install default to false', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const skipInstallOption = command.options.find((o: any) => o.long === '--skip-install');
      expect(skipInstallOption).to.exist;
      expect(skipInstallOption.defaultValue).to.equal(false);
    });
  });

  describe('moduleImportAddCommand export', () => {
    it('should be exported as a function', () => {
      const { moduleImportAddCommand } = require('../../../../../src/cli/module/imports/add');

      expect(moduleImportAddCommand).to.be.a('function');
    });

    it('should be an async function', () => {
      const { moduleImportAddCommand } = require('../../../../../src/cli/module/imports/add');

      expect(moduleImportAddCommand.constructor.name).to.equal('AsyncFunction');
    });
  });

  describe('moduleImportAddCommand action', () => {
    let testDir: string;
    let modulePath: string;
    let originalExitCode: typeof process.exitCode;
    let progressBarStartStub: sinon.SinonStub;
    let progressBarUpdateStub: sinon.SinonStub;
    let progressBarStopStub: sinon.SinonStub;

    beforeEach(async () => {
      testDir = await createTempDir('import-add-test');
      modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      // Create a valid module with package.json
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [],
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

    it('should add interface to module imports', async () => {
      const mockGitHelpers = createMockGitHelpers();
      const mockInterfaceInfo = createMockInterfaceInfo('logging', ['beta', '1.0']);

      mockGitHelpers.loadInterfaceFromGit.resolves(mockInterfaceInfo);
      mockGitHelpers.installInterfaces.resolves();

      const { moduleImportAddCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/add',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            displayNonDefaultGitWarning: sinon.stub().resolves(),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {}, git: {} },
          },
        },
      );

      await moduleImportAddCommand(['logging@beta'], {
        module: modulePath,
        optional: false,
        skipInstall: true,
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      // With skipInstall: true, imports are stored as objects { name, skipInstall }
      const hasImport = pkg.antelopeJs.imports.some(
        (imp: string | { name: string }) =>
          (typeof imp === 'string' ? imp : imp.name) === 'logging@beta',
      );
      expect(hasImport).to.be.true;
    });

    it('should handle interface not found', async () => {
      const mockGitHelpers = createMockGitHelpers();
      mockGitHelpers.loadInterfaceFromGit.resolves(undefined);
      mockGitHelpers.installInterfaces.resolves();

      const { moduleImportAddCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/add',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            displayNonDefaultGitWarning: sinon.stub().resolves(),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {}, git: {} },
          },
        },
      );

      await moduleImportAddCommand(['nonexistent@beta'], {
        module: modulePath,
        optional: false,
        skipInstall: true,
      });

      expect(cliUi.warning).to.have.been.called;
    });

    it('should add optional imports to importsOptional array', async () => {
      const mockGitHelpers = createMockGitHelpers();
      const mockInterfaceInfo = createMockInterfaceInfo('cache', ['beta']);

      mockGitHelpers.loadInterfaceFromGit.resolves(mockInterfaceInfo);
      mockGitHelpers.installInterfaces.resolves();

      const { moduleImportAddCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/add',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            displayNonDefaultGitWarning: sinon.stub().resolves(),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {}, git: {} },
          },
        },
      );

      await moduleImportAddCommand(['cache@beta'], {
        module: modulePath,
        optional: true,
        skipInstall: true,
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      // With skipInstall: true, imports are stored as objects { name, skipInstall }
      const hasOptionalImport = pkg.antelopeJs.importsOptional.some(
        (imp: string | { name: string }) =>
          (typeof imp === 'string' ? imp : imp.name) === 'cache@beta',
      );
      expect(hasOptionalImport).to.be.true;
    });

    it('should handle missing package.json', async () => {
      const emptyDir = path.join(testDir, 'empty');
      await fsp.mkdir(emptyDir, { recursive: true });

      const mockGitHelpers = createMockGitHelpers();
      mockGitHelpers.loadInterfaceFromGit.resolves(undefined);
      mockGitHelpers.installInterfaces.resolves();

      const { moduleImportAddCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/add',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            displayNonDefaultGitWarning: sinon.stub().resolves(),
            readModuleManifest: sinon.stub().resolves(undefined),
            writeModuleManifest: sinon.stub().resolves(),
            Options: { module: {}, git: {} },
          },
        },
      );

      await moduleImportAddCommand(['logging@beta'], {
        module: emptyDir,
        optional: false,
        skipInstall: true,
      });

      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;
    });

    it('should skip already imported interfaces', async () => {
      // Create module with existing import
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta'],
          importsOptional: [],
        },
      });

      const mockGitHelpers = createMockGitHelpers();
      const mockInterfaceInfo = createMockInterfaceInfo('logging', ['beta', '1.0']);

      mockGitHelpers.loadInterfaceFromGit.resolves(mockInterfaceInfo);
      mockGitHelpers.installInterfaces.resolves();

      const { moduleImportAddCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/add',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            displayNonDefaultGitWarning: sinon.stub().resolves(),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {}, git: {} },
          },
        },
      );

      await moduleImportAddCommand(['logging@beta'], {
        module: modulePath,
        optional: false,
        skipInstall: true,
      });

      // Should report as skipped (already imported)
      expect(cliUi.warning).to.have.been.called;

      // Verify the import array still has only one entry (no duplicates)
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      const loggingImports = pkg.antelopeJs.imports.filter(
        (imp: string | { name: string }) =>
          (typeof imp === 'string' ? imp : imp.name) === 'logging@beta',
      );
      expect(loggingImports.length).to.equal(1);
    });

    it('should handle version not found', async () => {
      const mockGitHelpers = createMockGitHelpers();
      const mockInterfaceInfo = createMockInterfaceInfo('logging', ['beta', '1.0']);

      mockGitHelpers.loadInterfaceFromGit.resolves(mockInterfaceInfo);
      mockGitHelpers.installInterfaces.resolves();

      const { moduleImportAddCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/add',
        {
          '../../git': createProxyquireGitModule(mockGitHelpers),
          '../../common': {
            readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
            displayNonDefaultGitWarning: sinon.stub().resolves(),
            readModuleManifest: async (modPath: string) => {
              return readJson(path.join(modPath, 'package.json'));
            },
            writeModuleManifest: async (modPath: string, manifest: any) => {
              await writeJson(path.join(modPath, 'package.json'), manifest);
            },
            Options: { module: {}, git: {} },
          },
        },
      );

      await moduleImportAddCommand(['logging@2.0'], {
        module: modulePath,
        optional: false,
        skipInstall: true,
      });

      // Should report error about version not found
      expect(cliUi.error).to.have.been.called;
      expect(cliUi.warning).to.have.been.called;

      // Verify the interface was not added
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports).to.not.include('logging@2.0');
    });
  });
});
