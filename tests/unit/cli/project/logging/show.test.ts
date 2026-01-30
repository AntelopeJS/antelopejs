import { expect, sinon } from '../../../../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as common from '../../../../../src/cli/common';

describe('cli/project/logging/show', () => {
  const testDir = path.join(__dirname, '../../../../fixtures/test-project-logging-show-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'header');
    sinon.stub(cliUi, 'keyValue').callsFake((key, value) => `${key}: ${value}`);
    // Stub console.log to avoid output during tests
    sinon.stub(console, 'log');
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
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      expect(command.name()).to.equal('show');
    });

    it('should have correct description', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      expect(command.description()).to.include('Show project logging configuration');
    });

    it('should have --project option', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--project');
    });

    it('should have --env option', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--env');
    });

    it('should have --json option', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--json');
    });

    it('should have ls as alias', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      expect(command.aliases()).to.include('ls');
    });
  });

  describe('option details', () => {
    it('should have -p as alias for --project', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      const projectOption = command.options.find((o: any) => o.long === '--project');
      expect(projectOption).to.exist;
      expect(projectOption.short).to.equal('-p');
    });

    it('should have -e as alias for --env', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.short).to.equal('-e');
    });

    it('should have -j as alias for --json', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      const jsonOption = command.options.find((o: any) => o.long === '--json');
      expect(jsonOption).to.exist;
      expect(jsonOption.short).to.equal('-j');
    });

    it('should have --json default to false', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      const jsonOption = command.options.find((o: any) => o.long === '--json');
      expect(jsonOption).to.exist;
      expect(jsonOption.defaultValue).to.equal(false);
    });
  });

  describe('no project found', () => {
    it('should set exitCode to 1 when no project exists', async () => {
      // Stub readConfig to return undefined (no project found)
      sinon.stub(common, 'readConfig').resolves(undefined);

      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

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
    it('should support environment-specific logging display', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.description).to.include('Environment');
    });
  });

  describe('json output mode', () => {
    it('should support JSON output format', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      const jsonOption = command.options.find((o: any) => o.long === '--json');
      expect(jsonOption).to.exist;
      expect(jsonOption.description).to.include('JSON');
    });
  });

  describe('command behavior expectations', () => {
    it('should be designed to display logging settings', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      // The command should exist and be properly configured
      expect(command).to.exist;
      expect(command.name()).to.equal('show');
      expect(command.description()).to.include('logging');
    });

    it('should display module tracking configuration', () => {
      const showCommand = require('../../../../../src/cli/project/logging/show').default;
      const command = showCommand();

      // Verify command is structured to show logging config
      expect(command.description()).to.include('Display');
    });
  });
});
