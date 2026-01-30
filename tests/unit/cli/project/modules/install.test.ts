import { expect, sinon } from '../../../../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as common from '../../../../../src/cli/common';
import * as terminalDisplay from '../../../../../src/logging/terminal-display';

describe('cli/project/modules/install', () => {
  const testDir = path.join(__dirname, '../../../../fixtures/test-project-modules-install-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
    // Stub terminal display
    sinon.stub(terminalDisplay.terminalDisplay, 'startSpinner').resolves();
    sinon.stub(terminalDisplay.terminalDisplay, 'stopSpinner').resolves();
    sinon.stub(terminalDisplay.terminalDisplay, 'failSpinner').resolves();
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
      const installCommand = require('../../../../../src/cli/project/modules/install').default;
      const command = installCommand();

      expect(command.name()).to.equal('install');
    });

    it('should have correct description', () => {
      const installCommand = require('../../../../../src/cli/project/modules/install').default;
      const command = installCommand();

      expect(command.description()).to.include('Install module dependencies');
    });

    it('should have --project option', () => {
      const installCommand = require('../../../../../src/cli/project/modules/install').default;
      const command = installCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--project');
    });

    it('should have --env option', () => {
      const installCommand = require('../../../../../src/cli/project/modules/install').default;
      const command = installCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--env');
    });

    it('should have --git option', () => {
      const installCommand = require('../../../../../src/cli/project/modules/install').default;
      const command = installCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--git');
    });
  });

  describe('option details', () => {
    it('should have -p as alias for --project', () => {
      const installCommand = require('../../../../../src/cli/project/modules/install').default;
      const command = installCommand();

      const projectOption = command.options.find((o: any) => o.long === '--project');
      expect(projectOption).to.exist;
      expect(projectOption.short).to.equal('-p');
    });

    it('should have -e as alias for --env', () => {
      const installCommand = require('../../../../../src/cli/project/modules/install').default;
      const command = installCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.short).to.equal('-e');
    });

    it('should have -g as alias for --git', () => {
      const installCommand = require('../../../../../src/cli/project/modules/install').default;
      const command = installCommand();

      const gitOption = command.options.find((o: any) => o.long === '--git');
      expect(gitOption).to.exist;
      expect(gitOption.short).to.equal('-g');
    });
  });

  describe('no project found', () => {
    it('should set exitCode to 1 when no project exists', async () => {
      // Stub readConfig to return undefined (no project found)
      sinon.stub(common, 'readConfig').resolves(undefined);
      sinon.stub(common, 'readUserConfig').resolves({ git: 'https://github.com/test/repo' });
      sinon.stub(common, 'displayNonDefaultGitWarning').resolves();

      const installCommand = require('../../../../../src/cli/project/modules/install').default;
      const command = installCommand();

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
    it('should support environment-specific installation', () => {
      const installCommand = require('../../../../../src/cli/project/modules/install').default;
      const command = installCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.description).to.include('Environment');
    });
  });

  describe('git repository handling', () => {
    it('should support custom git repository', () => {
      const installCommand = require('../../../../../src/cli/project/modules/install').default;
      const command = installCommand();

      const gitOption = command.options.find((o: any) => o.long === '--git');
      expect(gitOption).to.exist;
    });
  });

  describe('command behavior expectations', () => {
    it('should be designed to analyze and resolve dependencies', () => {
      const installCommand = require('../../../../../src/cli/project/modules/install').default;
      const command = installCommand();

      // The command should exist and be properly configured
      expect(command).to.exist;
      expect(command.name()).to.equal('install');
      expect(command.description()).to.include('dependencies');
    });
  });
});
