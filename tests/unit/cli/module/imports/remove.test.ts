import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as fsp from 'fs/promises';
import path from 'path';
import { createTempDir, cleanupDir, writeJson, readJson } from '../../../../helpers/integration';
import proxyquire from 'proxyquire';

describe('cli/module/imports/remove', () => {
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
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      expect(command.name()).to.equal('remove');
    });

    it('should have correct description', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      expect(command.description()).to.include('Remove imported interfaces');
    });

    it('should have rm alias', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      expect(command.aliases()).to.include('rm');
    });

    it('should have --module option', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });

    it('should require interfaces argument', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('interfaces');
    });

    it('should accept variadic interfaces argument', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.true;
    });

    it('should have required interfaces argument', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      const args = command.registeredArguments;
      expect(args[0].required).to.be.true;
    });
  });

  describe('command options count', () => {
    it('should have exactly one option (--module)', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      // Should only have the --module option
      expect(command.options.length).to.equal(1);
    });
  });

  describe('moduleImportRemoveCommand export', () => {
    it('should be exported as a function', () => {
      const { moduleImportRemoveCommand } = require('../../../../../src/cli/module/imports/remove');

      expect(moduleImportRemoveCommand).to.be.a('function');
    });

    it('should be an async function', () => {
      const { moduleImportRemoveCommand } = require('../../../../../src/cli/module/imports/remove');

      expect(moduleImportRemoveCommand.constructor.name).to.equal('AsyncFunction');
    });
  });

  describe('moduleImportRemoveCommand action', () => {
    let testDir: string;
    let modulePath: string;
    let originalExitCode: typeof process.exitCode;

    beforeEach(async () => {
      testDir = await createTempDir('import-remove-test');
      modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      originalExitCode = process.exitCode;
    });

    afterEach(async () => {
      await cleanupDir(testDir);
      process.exitCode = originalExitCode;
      // Note: sinon.restore() is called by the parent afterEach
    });

    it('should remove existing import from imports array', async () => {
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

      // Create the .antelope directory structure for removeInterface to clean up
      const antelopePath = path.join(modulePath, '.antelope', 'interfaces.d', 'logging', 'beta');
      await fsp.mkdir(antelopePath, { recursive: true });
      await fsp.writeFile(path.join(antelopePath, 'index.d.ts'), '// interface file');

      const removeInterfaceStub = sinon.stub().resolves();

      const { moduleImportRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/remove',
        {
          '../../git': {
            removeInterface: removeInterfaceStub,
          },
          '../../common': {
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

      await moduleImportRemoveCommand(['logging@beta'], {
        module: modulePath,
      });

      // Verify removeInterface was called
      expect(removeInterfaceStub).to.have.been.calledOnce;
      expect(removeInterfaceStub).to.have.been.calledWith(modulePath, 'logging', 'beta');

      // Verify the package.json was updated
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports).to.not.include('logging@beta');
      expect(pkg.antelopeJs.imports).to.include('database@1.0');

      // Verify success message was shown
      expect(cliUi.success).to.have.been.called;
    });

    it('should remove non-existent import (with warning)', async () => {
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

      const removeInterfaceStub = sinon.stub().resolves();

      const { moduleImportRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/remove',
        {
          '../../git': {
            removeInterface: removeInterfaceStub,
          },
          '../../common': {
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

      // Try to remove an interface that doesn't exist
      await moduleImportRemoveCommand(['nonexistent@1.0'], {
        module: modulePath,
      });

      // Verify error is shown and exit code is set
      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;

      // removeInterface should not be called for non-existent imports
      expect(removeInterfaceStub).to.not.have.been.called;
    });

    it('should handle missing package.json', async () => {
      const emptyDir = path.join(testDir, 'empty');
      await fsp.mkdir(emptyDir, { recursive: true });

      const removeInterfaceStub = sinon.stub().resolves();

      const { moduleImportRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/remove',
        {
          '../../git': {
            removeInterface: removeInterfaceStub,
          },
          '../../common': {
            readModuleManifest: sinon.stub().resolves(undefined),
            writeModuleManifest: sinon.stub().resolves(),
            Options: { module: {} },
          },
        },
      );

      await moduleImportRemoveCommand(['logging@beta'], {
        module: emptyDir,
      });

      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;
      expect(removeInterfaceStub).to.not.have.been.called;
    });

    it('should remove optional import from importsOptional', async () => {
      // Create a valid module with package.json containing optional imports
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [],
          importsOptional: ['cache@1.0', 'analytics@beta'],
        },
      });

      const removeInterfaceStub = sinon.stub().resolves();

      const { moduleImportRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/remove',
        {
          '../../git': {
            removeInterface: removeInterfaceStub,
          },
          '../../common': {
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

      await moduleImportRemoveCommand(['cache@1.0'], {
        module: modulePath,
      });

      // Verify removeInterface was called
      expect(removeInterfaceStub).to.have.been.calledOnce;
      expect(removeInterfaceStub).to.have.been.calledWith(modulePath, 'cache', '1.0');

      // Verify the package.json was updated
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.importsOptional).to.not.include('cache@1.0');
      expect(pkg.antelopeJs.importsOptional).to.include('analytics@beta');

      // Verify success message was shown
      expect(cliUi.success).to.have.been.called;
    });

    it('should call removeInterface for cleanup', async () => {
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

      const removeInterfaceStub = sinon.stub().resolves();

      const { moduleImportRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/remove',
        {
          '../../git': {
            removeInterface: removeInterfaceStub,
          },
          '../../common': {
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

      await moduleImportRemoveCommand(['logging@beta'], {
        module: modulePath,
      });

      // Verify removeInterface was called to clean up the interface files
      expect(removeInterfaceStub).to.have.been.calledOnce;
      expect(removeInterfaceStub).to.have.been.calledWith(modulePath, 'logging', 'beta');
    });

    it('should handle removeInterface error gracefully', async () => {
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

      const removeInterfaceStub = sinon.stub().rejects(new Error('Permission denied'));

      const { moduleImportRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/remove',
        {
          '../../git': {
            removeInterface: removeInterfaceStub,
          },
          '../../common': {
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

      await moduleImportRemoveCommand(['logging@beta'], {
        module: modulePath,
      });

      // Verify error was reported
      expect(cliUi.error).to.have.been.called;

      // Package.json should not be updated since removal failed
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports).to.include('logging@beta');
    });

    it('should handle malformed interface name', async () => {
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

      const removeInterfaceStub = sinon.stub().resolves();

      const { moduleImportRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/remove',
        {
          '../../git': {
            removeInterface: removeInterfaceStub,
          },
          '../../common': {
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

      // Try to remove interface without version
      await moduleImportRemoveCommand(['logging'], {
        module: modulePath,
      });

      // Verify error is shown and exit code is set
      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;

      // removeInterface should not be called for malformed interface name
      expect(removeInterfaceStub).to.not.have.been.called;
    });

    it('should remove multiple interfaces at once', async () => {
      // Create a valid module with package.json containing multiple imports
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta', 'database@1.0', 'auth@2.0'],
          importsOptional: [],
        },
      });

      const removeInterfaceStub = sinon.stub().resolves();

      const { moduleImportRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/remove',
        {
          '../../git': {
            removeInterface: removeInterfaceStub,
          },
          '../../common': {
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

      await moduleImportRemoveCommand(['logging@beta', 'database@1.0'], {
        module: modulePath,
      });

      // Verify removeInterface was called twice
      expect(removeInterfaceStub).to.have.been.calledTwice;
      expect(removeInterfaceStub).to.have.been.calledWith(modulePath, 'logging', 'beta');
      expect(removeInterfaceStub).to.have.been.calledWith(modulePath, 'database', '1.0');

      // Verify the package.json was updated
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports).to.not.include('logging@beta');
      expect(pkg.antelopeJs.imports).to.not.include('database@1.0');
      expect(pkg.antelopeJs.imports).to.include('auth@2.0');

      // Verify success message was shown
      expect(cliUi.success).to.have.been.called;
    });

    it('should warn about missing interfaces but continue with existing ones', async () => {
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

      const removeInterfaceStub = sinon.stub().resolves();

      const { moduleImportRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/remove',
        {
          '../../git': {
            removeInterface: removeInterfaceStub,
          },
          '../../common': {
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

      // Try to remove one existing and one non-existing interface
      await moduleImportRemoveCommand(['logging@beta', 'nonexistent@1.0'], {
        module: modulePath,
      });

      // Verify warning was shown for missing interface
      expect(cliUi.warning).to.have.been.called;

      // Verify only existing interface was removed
      expect(removeInterfaceStub).to.have.been.calledOnce;
      expect(removeInterfaceStub).to.have.been.calledWith(modulePath, 'logging', 'beta');

      // Verify success message was shown for the one that was removed
      expect(cliUi.success).to.have.been.called;

      // Verify the package.json was updated
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports).to.not.include('logging@beta');
    });

    it('should handle module without antelopeJs section by initializing it', async () => {
      // Create a package.json without antelopeJs section
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
      });

      const removeInterfaceStub = sinon.stub().resolves();

      const { moduleImportRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/module/imports/remove',
        {
          '../../git': {
            removeInterface: removeInterfaceStub,
          },
          '../../common': {
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

      // Try to remove interface from module without antelopeJs
      await moduleImportRemoveCommand(['logging@beta'], {
        module: modulePath,
      });

      // Should get error because interface is not imported
      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;
    });
  });
});
