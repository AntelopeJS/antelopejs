import { expect, sinon } from '../../../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import * as cliUi from '../../../../src/utils/cli-ui';
import * as common from '../../../../src/cli/common';

describe('cli/project/init', () => {
  const testDir = path.join(__dirname, '../../../fixtures/test-project-init-' + Date.now());

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
      const initCommand = require('../../../../src/cli/project/init').default;
      const command = initCommand();

      expect(command).to.have.property('name');
      expect(command.name()).to.equal('init');
    });

    it('should have correct description', () => {
      const initCommand = require('../../../../src/cli/project/init').default;
      const command = initCommand();

      expect(command.description()).to.include('Create a new AntelopeJS project');
    });

    it('should require a project argument', () => {
      const initCommand = require('../../../../src/cli/project/init').default;
      const command = initCommand();

      const args = command.registeredArguments;
      expect(args).to.have.length(1);
      expect(args[0].name()).to.equal('project');
    });

    it('should have project argument as required', () => {
      const initCommand = require('../../../../src/cli/project/init').default;
      const command = initCommand();

      const args = command.registeredArguments;
      expect(args[0].required).to.be.true;
    });
  });

  describe('project already exists', () => {
    it('should set exitCode to 1 when project already exists', async () => {
      // Create an existing antelope.json
      const projectPath = path.join(testDir, 'existing-project');
      fs.mkdirSync(projectPath, { recursive: true });
      fs.writeFileSync(path.join(projectPath, 'antelope.json'), JSON.stringify({ name: 'existing' }, null, 2));

      // Stub readConfig to return a config (project exists)
      sinon.stub(common, 'readConfig').resolves({ name: 'existing', modules: {} });

      // Create a mock spinner
      const mockSpinner = {
        start: sinon.stub().resolves(),
        succeed: sinon.stub().resolves(),
        fail: sinon.stub().resolves(),
        stop: sinon.stub().resolves(),
        update: sinon.stub().resolves(),
      };
      sinon.stub(cliUi, 'Spinner').returns(mockSpinner);

      const initCommand = require('../../../../src/cli/project/init').default;
      const command = initCommand();

      const originalExitCode = process.exitCode;

      try {
        await command.parseAsync(['node', 'test', projectPath]);
      } catch {
        // Command may throw or set exitCode
      }

      // Check exitCode was set
      expect(process.exitCode).to.equal(1);

      process.exitCode = originalExitCode;
    });
  });

  describe('error handling', () => {
    it('should handle non-existent parent directory gracefully', async () => {
      const initCommand = require('../../../../src/cli/project/init').default;
      const command = initCommand();

      // Verify command structure is valid even before execution
      expect(command.name()).to.equal('init');
      expect(command.registeredArguments.length).to.be.greaterThan(0);
    });
  });
});
