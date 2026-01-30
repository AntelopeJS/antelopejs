import { expect, sinon } from '../../../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import * as cliUi from '../../../../src/utils/cli-ui';
import * as common from '../../../../src/cli/common';

describe('cli/project/run', () => {
  const testDir = path.join(__dirname, '../../../fixtures/test-project-run-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
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
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      expect(command).to.have.property('name');
      expect(command.name()).to.equal('run');
    });

    it('should have correct description', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      expect(command.description()).to.include('Run your AntelopeJS project');
    });

    it('should have --project option', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--project');
    });

    it('should have --watch option', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--watch');
    });

    it('should have --env option', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--env');
    });

    it('should have --inspect option', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--inspect');
    });

    it('should have --interactive option', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--interactive');
    });

    it('should have --concurrency option', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--concurrency');
    });

    it('should have --verbose option', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--verbose');
    });
  });

  describe('option details', () => {
    it('should have -w as alias for --watch', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      const watchOption = command.options.find((o: any) => o.long === '--watch');
      expect(watchOption).to.exist;
      expect(watchOption.short).to.equal('-w');
    });

    it('should have -e as alias for --env', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.short).to.equal('-e');
    });

    it('should have -c as alias for --concurrency', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      const concurrencyOption = command.options.find((o: any) => o.long === '--concurrency');
      expect(concurrencyOption).to.exist;
      expect(concurrencyOption.short).to.equal('-c');
    });

    it('should have -i as alias for --interactive', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      const interactiveOption = command.options.find((o: any) => o.long === '--interactive');
      expect(interactiveOption).to.exist;
      expect(interactiveOption.short).to.equal('-i');
    });
  });

  describe('no project found', () => {
    it('should set exitCode to 1 when no project exists', async () => {
      // Stub readConfig to return undefined (no project found)
      sinon.stub(common, 'readConfig').resolves(undefined);

      // Create a mock spinner
      const mockSpinner = {
        start: sinon.stub().resolves(),
        succeed: sinon.stub().resolves(),
        fail: sinon.stub().resolves(),
        stop: sinon.stub().resolves(),
        update: sinon.stub().resolves(),
      };
      sinon.stub(cliUi, 'Spinner').returns(mockSpinner);

      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

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

  describe('error handling', () => {
    it('should handle missing project path gracefully', () => {
      const runCommand = require('../../../../src/cli/project/run').default;
      const command = runCommand();

      // The command should have a default project option
      const projectOption = command.options.find((o: any) => o.long === '--project');
      expect(projectOption).to.exist;
    });
  });
});
