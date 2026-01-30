import { expect, sinon } from '../../../../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as common from '../../../../../src/cli/common';

describe('cli/project/logging/set', () => {
  const testDir = path.join(__dirname, '../../../../fixtures/test-project-logging-set-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
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
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      expect(command.name()).to.equal('set');
    });

    it('should have correct description', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      expect(command.description()).to.include('Configure project logging settings');
    });

    it('should have --project option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--project');
    });

    it('should have --env option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--env');
    });

    it('should have --enable option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--enable');
    });

    it('should have --disable option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--disable');
    });

    it('should have --enableModuleTracking option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--enableModuleTracking');
    });

    it('should have --disableModuleTracking option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--disableModuleTracking');
    });

    it('should have --includeModule option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--includeModule');
    });

    it('should have --excludeModule option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--excludeModule');
    });

    it('should have --removeInclude option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--removeInclude');
    });

    it('should have --removeExclude option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--removeExclude');
    });

    it('should have --level option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--level');
    });

    it('should have --format option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--format');
    });

    it('should have --dateFormat option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--dateFormat');
    });

    it('should have --interactive option', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--interactive');
    });
  });

  describe('option details', () => {
    it('should have -p as alias for --project', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const projectOption = command.options.find((o: any) => o.long === '--project');
      expect(projectOption).to.exist;
      expect(projectOption.short).to.equal('-p');
    });

    it('should have -e as alias for --env', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.short).to.equal('-e');
    });

    it('should have -i as alias for --interactive', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const interactiveOption = command.options.find((o: any) => o.long === '--interactive');
      expect(interactiveOption).to.exist;
      expect(interactiveOption.short).to.equal('-i');
    });

    it('should have --interactive default to false', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const interactiveOption = command.options.find((o: any) => o.long === '--interactive');
      expect(interactiveOption).to.exist;
      expect(interactiveOption.defaultValue).to.equal(false);
    });

    it('should have --level with valid choices', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const levelOption = command.options.find((o: any) => o.long === '--level');
      expect(levelOption).to.exist;
      expect(levelOption.argChoices).to.include('trace');
      expect(levelOption.argChoices).to.include('debug');
      expect(levelOption.argChoices).to.include('info');
      expect(levelOption.argChoices).to.include('warn');
      expect(levelOption.argChoices).to.include('error');
      expect(levelOption.argChoices).to.include('default');
    });
  });

  describe('no project found', () => {
    it('should set exitCode to 1 when no project exists', async () => {
      // Stub readConfig to return undefined (no project found)
      sinon.stub(common, 'readConfig').resolves(undefined);

      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const originalExitCode = process.exitCode;

      try {
        await command.parseAsync(['node', 'test', '--project', path.join(testDir, 'nonexistent'), '--enable']);
      } catch {
        // Command may throw or set exitCode
      }

      expect(process.exitCode).to.equal(1);
      process.exitCode = originalExitCode;
    });
  });

  describe('environment handling', () => {
    it('should support environment-specific logging configuration', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.description).to.include('Environment');
    });
  });

  describe('interactive mode', () => {
    it('should support interactive configuration mode', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const interactiveOption = command.options.find((o: any) => o.long === '--interactive');
      expect(interactiveOption).to.exist;
      expect(interactiveOption.description).to.include('Interactive');
    });
  });

  describe('command behavior expectations', () => {
    it('should be designed to configure logging settings', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      // The command should exist and be properly configured
      expect(command).to.exist;
      expect(command.name()).to.equal('set');
      expect(command.description()).to.include('logging');
    });

    it('should support module tracking configuration', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--enableModuleTracking');
      expect(options).to.include('--disableModuleTracking');
    });

    it('should support include/exclude module lists', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--includeModule');
      expect(options).to.include('--excludeModule');
      expect(options).to.include('--removeInclude');
      expect(options).to.include('--removeExclude');
    });

    it('should support log format configuration', () => {
      const setCommand = require('../../../../../src/cli/project/logging/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--level');
      expect(options).to.include('--format');
      expect(options).to.include('--dateFormat');
    });
  });
});
