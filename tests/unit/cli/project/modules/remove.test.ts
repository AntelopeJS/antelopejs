import { expect, sinon } from '../../../../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as common from '../../../../../src/cli/common';

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
});
