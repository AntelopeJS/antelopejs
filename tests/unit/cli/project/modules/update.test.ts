import { expect, sinon } from '../../../../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as common from '../../../../../src/cli/common';

describe('cli/project/modules/update', () => {
  const testDir = path.join(__dirname, '../../../../fixtures/test-project-modules-update-' + Date.now());

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
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      expect(command.name()).to.equal('update');
    });

    it('should have correct description', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      expect(command.description()).to.include('Update modules to latest versions');
    });

    it('should have --project option', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--project');
    });

    it('should have --env option', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--env');
    });

    it('should have --dry-run option', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--dry-run');
    });

    it('should accept optional modules argument', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('modules');
    });

    it('should accept variadic modules argument', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.true;
    });

    it('should have modules argument as optional', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const args = command.registeredArguments;
      expect(args[0].required).to.be.false;
    });
  });

  describe('option details', () => {
    it('should have -p as alias for --project', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const projectOption = command.options.find((o: any) => o.long === '--project');
      expect(projectOption).to.exist;
      expect(projectOption.short).to.equal('-p');
    });

    it('should have -e as alias for --env', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.short).to.equal('-e');
    });

    it('should have --dry-run default to false', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const dryRunOption = command.options.find((o: any) => o.long === '--dry-run');
      expect(dryRunOption).to.exist;
      expect(dryRunOption.defaultValue).to.equal(false);
    });
  });

  describe('no project found', () => {
    it('should set exitCode to 1 when no project exists', async () => {
      // Stub readConfig to return undefined (no project found)
      sinon.stub(common, 'readConfig').resolves(undefined);

      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const originalExitCode = process.exitCode;

      try {
        await command.parseAsync(['node', 'test', '--project', path.join(testDir, 'nonexistent')]);
      } catch {
        // Command may throw or set exitCode
      }

      expect(process.exitCode).to.equal(1);
      process.exitCode = originalExitCode;
    });
  });

  describe('environment handling', () => {
    it('should support environment-specific module updates', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.description).to.include('Environment');
    });
  });

  describe('dry-run behavior', () => {
    it('should support dry-run mode for previewing updates', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const dryRunOption = command.options.find((o: any) => o.long === '--dry-run');
      expect(dryRunOption).to.exist;
      expect(dryRunOption.description).to.include('without making changes');
    });
  });

  describe('command behavior expectations', () => {
    it('should be designed to check npm for updates', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      // The command should exist and be properly configured
      expect(command).to.exist;
      expect(command.name()).to.equal('update');
      expect(command.description()).to.include('npm');
    });
  });
});
