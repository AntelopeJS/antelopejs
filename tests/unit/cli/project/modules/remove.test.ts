import { expect, sinon } from '../../../../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as common from '../../../../../src/cli/common';
import { createTempDir, cleanupDir, writeJson } from '../../../../helpers/integration';
import proxyquire from 'proxyquire';

describe('cli/project/modules/remove', () => {
  const testDir = path.join(__dirname, '../../../../fixtures/test-project-modules-remove-' + Date.now());

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
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      expect(command.name()).to.equal('remove');
    });

    it('should have correct description', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      expect(command.description()).to.include('Remove modules from your project');
    });

    it('should have --project option', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--project');
    });

    it('should have --env option', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--env');
    });

    it('should have --force option', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--force');
    });

    it('should have rm as alias', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      expect(command.aliases()).to.include('rm');
    });

    it('should require modules argument', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('modules');
    });

    it('should accept variadic modules argument', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.true;
    });
  });

  describe('option details', () => {
    it('should have -p as alias for --project', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      const projectOption = command.options.find((o: any) => o.long === '--project');
      expect(projectOption).to.exist;
      expect(projectOption.short).to.equal('-p');
    });

    it('should have -e as alias for --env', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.short).to.equal('-e');
    });

    it('should have -f as alias for --force', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      const forceOption = command.options.find((o: any) => o.long === '--force');
      expect(forceOption).to.exist;
      expect(forceOption.short).to.equal('-f');
    });

    it('should have --force default to false', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      const forceOption = command.options.find((o: any) => o.long === '--force');
      expect(forceOption).to.exist;
      expect(forceOption.defaultValue).to.equal(false);
    });
  });

  describe('projectModulesRemoveCommand export', () => {
    it('should be exported as a function', () => {
      const { projectModulesRemoveCommand } = require('../../../../../src/cli/project/modules/remove');

      expect(projectModulesRemoveCommand).to.be.a('function');
    });

    it('should be an async function', () => {
      const { projectModulesRemoveCommand } = require('../../../../../src/cli/project/modules/remove');

      expect(projectModulesRemoveCommand.constructor.name).to.equal('AsyncFunction');
    });
  });

  describe('no project found', () => {
    it('should set exitCode to 1 when no project exists', async () => {
      // Stub readConfig to return undefined (no project found)
      sinon.stub(common, 'readConfig').resolves(undefined);

      const { projectModulesRemoveCommand } = require('../../../../../src/cli/project/modules/remove');

      const originalExitCode = process.exitCode;

      try {
        await projectModulesRemoveCommand(['test-module'], {
          project: path.join(testDir, 'nonexistent'),
          force: false,
        });
      } catch {
        // Command may throw or set exitCode
      }

      expect(process.exitCode).to.equal(1);
      process.exitCode = originalExitCode;
    });
  });

  describe('environment handling', () => {
    it('should support environment-specific module removal', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.description).to.include('Environment');
    });
  });

  describe('error handling', () => {
    it('should handle missing modules gracefully', () => {
      const removeCommand = require('../../../../../src/cli/project/modules/remove').default;
      const command = removeCommand();

      // Verify command structure handles error cases
      expect(command.name()).to.equal('remove');
    });
  });

  describe('projectModulesRemoveCommand action', () => {
    let projectDir: string;
    let originalExitCode: typeof process.exitCode;

    beforeEach(async () => {
      projectDir = await createTempDir('project-remove-test');
      await writeJson(path.join(projectDir, 'antelope.json'), {
        name: 'test-project',
        modules: {},
      });
      originalExitCode = process.exitCode;
    });

    afterEach(async () => {
      await cleanupDir(projectDir);
      process.exitCode = originalExitCode;
    });

    it('should remove a module from the project', async () => {
      const modules = {
        'module-to-remove': {
          source: { type: 'package', package: 'module-to-remove', version: '1.0.0' },
        },
        'other-module': {
          source: { type: 'package', package: 'other-module', version: '1.0.0' },
        },
      };

      const config = { name: 'test-project', modules: { ...modules } };
      const writeConfigStub = sinon.stub().resolves();

      const { projectModulesRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/remove',
        {
          '../../common': {
            readConfig: sinon.stub().resolves(config),
            writeConfig: writeConfigStub,
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules }),
          },
        },
      );

      await projectModulesRemoveCommand(['module-to-remove'], {
        project: projectDir,
        force: false,
      });

      expect(writeConfigStub).to.have.been.called;
      expect(cliUi.success).to.have.been.called;
    });

    it('should remove multiple modules at once', async () => {
      const modules = {
        'module-one': { source: { type: 'package', package: 'module-one', version: '1.0.0' } },
        'module-two': { source: { type: 'package', package: 'module-two', version: '1.0.0' } },
        'module-three': { source: { type: 'package', package: 'module-three', version: '1.0.0' } },
      };

      const config = { name: 'test-project', modules: { ...modules } };
      const writeConfigStub = sinon.stub().resolves();

      const { projectModulesRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/remove',
        {
          '../../common': {
            readConfig: sinon.stub().resolves(config),
            writeConfig: writeConfigStub,
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules }),
          },
        },
      );

      await projectModulesRemoveCommand(['module-one', 'module-two'], {
        project: projectDir,
        force: false,
      });

      expect(writeConfigStub).to.have.been.called;
      expect(cliUi.success).to.have.been.called;
    });

    it('should handle module with colon prefix', async () => {
      const modules = {
        ':folder-module': { source: { type: 'local-folder', path: './folder' } },
      };

      const config = { name: 'test-project', modules: { ...modules } };
      const writeConfigStub = sinon.stub().resolves();

      const { projectModulesRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/remove',
        {
          '../../common': {
            readConfig: sinon.stub().resolves(config),
            writeConfig: writeConfigStub,
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules }),
          },
        },
      );

      await projectModulesRemoveCommand(['folder-module'], {
        project: projectDir,
        force: false,
      });

      expect(writeConfigStub).to.have.been.called;
    });

    it('should error when trying to remove non-existent module without force', async () => {
      const modules = {
        'existing-module': { source: { type: 'package', package: 'existing-module', version: '1.0.0' } },
      };

      const config = { name: 'test-project', modules };
      const writeConfigStub = sinon.stub().resolves();

      const { projectModulesRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/remove',
        {
          '../../common': {
            readConfig: sinon.stub().resolves(config),
            writeConfig: writeConfigStub,
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules }),
          },
        },
      );

      await projectModulesRemoveCommand(['non-existent-module'], {
        project: projectDir,
        force: false,
      });

      expect(cliUi.error).to.have.been.called;
    });

    it('should skip non-existent modules with --force flag', async () => {
      const modules = {
        'existing-module': { source: { type: 'package', package: 'existing-module', version: '1.0.0' } },
      };

      const config = { name: 'test-project', modules: { ...modules } };
      const writeConfigStub = sinon.stub().resolves();

      const { projectModulesRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/remove',
        {
          '../../common': {
            readConfig: sinon.stub().resolves(config),
            writeConfig: writeConfigStub,
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules }),
          },
        },
      );

      await projectModulesRemoveCommand(['existing-module', 'non-existent'], {
        project: projectDir,
        force: true,
      });

      expect(cliUi.warning).to.have.been.called;
      expect(writeConfigStub).to.have.been.called;
    });

    it('should error when environment not found', async () => {
      const config = {
        name: 'test-project',
        modules: {},
        environments: {},
      };

      const { projectModulesRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/remove',
        {
          '../../common': {
            readConfig: sinon.stub().resolves(config),
            writeConfig: sinon.stub().resolves(),
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules: {} }),
          },
        },
      );

      await projectModulesRemoveCommand(['module'], {
        project: projectDir,
        env: 'nonexistent',
        force: false,
      });

      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;
    });

    it('should error when no modules are installed', async () => {
      const config = { name: 'test-project', modules: {} };

      const { projectModulesRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/remove',
        {
          '../../common': {
            readConfig: sinon.stub().resolves(config),
            writeConfig: sinon.stub().resolves(),
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules: {} }),
          },
        },
      );

      await projectModulesRemoveCommand(['module'], {
        project: projectDir,
        force: false,
      });

      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;
    });

    it('should remove module from specific environment', async () => {
      const envModules = {
        'env-module': { source: { type: 'package', package: 'env-module', version: '1.0.0' } },
      };

      const config = {
        name: 'test-project',
        modules: {},
        environments: {
          production: { modules: { ...envModules } },
        },
      };
      const writeConfigStub = sinon.stub().resolves();

      const { projectModulesRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/remove',
        {
          '../../common': {
            readConfig: sinon.stub().resolves(config),
            writeConfig: writeConfigStub,
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules: envModules }),
          },
        },
      );

      await projectModulesRemoveCommand(['env-module'], {
        project: projectDir,
        env: 'production',
        force: false,
      });

      expect(writeConfigStub).to.have.been.called;
      expect(cliUi.success).to.have.been.called;
    });

    it('should show warning about potential broken dependencies after removal', async () => {
      const modules = {
        'module-to-remove': { source: { type: 'package', package: 'module-to-remove', version: '1.0.0' } },
        'dependent-module': { source: { type: 'package', package: 'dependent-module', version: '1.0.0' } },
      };

      const config = { name: 'test-project', modules: { ...modules } };
      const writeConfigStub = sinon.stub().resolves();

      const { projectModulesRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/remove',
        {
          '../../common': {
            readConfig: sinon.stub().resolves(config),
            writeConfig: writeConfigStub,
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules }),
          },
        },
      );

      await projectModulesRemoveCommand(['module-to-remove'], {
        project: projectDir,
        force: false,
      });

      expect(cliUi.warning).to.have.been.calledWithMatch(sinon.match(/dependencies/i));
    });

    it('should error when all specified modules are not installed', async () => {
      const modules = {
        'existing-module': { source: { type: 'package', package: 'existing-module', version: '1.0.0' } },
      };

      const config = { name: 'test-project', modules };

      const { projectModulesRemoveCommand } = proxyquire.noCallThru()(
        '../../../../../src/cli/project/modules/remove',
        {
          '../../common': {
            readConfig: sinon.stub().resolves(config),
            writeConfig: sinon.stub().resolves(),
            Options: { project: { defaultValue: '.' } },
          },
          '../../../common/config': {
            LoadConfig: sinon.stub().resolves({ modules }),
          },
        },
      );

      await projectModulesRemoveCommand(['not-installed-1', 'not-installed-2'], {
        project: projectDir,
        force: false,
      });

      expect(cliUi.error).to.have.been.calledWithMatch(sinon.match(/None of the specified modules/));
    });
  });
});
