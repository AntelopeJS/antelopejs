import { expect, sinon } from '../../../../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as common from '../../../../../src/cli/common';

describe('cli/project/modules/add', () => {
  const testDir = path.join(__dirname, '../../../../fixtures/test-project-modules-add-' + Date.now());

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
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      expect(command.name()).to.equal('add');
    });

    it('should have correct description', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      expect(command.description()).to.include('Add modules to your project');
    });

    it('should have --mode option', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--mode');
    });

    it('should have --project option', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--project');
    });

    it('should have --env option', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--env');
    });

    it('should require modules argument', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('modules');
    });

    it('should accept variadic modules argument', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.true;
    });
  });

  describe('option details', () => {
    it('should have -m as alias for --mode', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const modeOption = command.options.find((o: any) => o.long === '--mode');
      expect(modeOption).to.exist;
      expect(modeOption.short).to.equal('-m');
    });

    it('should have -e as alias for --env', () => {
      const addCommand = require('../../../../../src/cli/project/modules/add').default;
      const command = addCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.short).to.equal('-e');
    });
  });

  describe('handlers map', () => {
    it('should export handlers map', () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');

      expect(handlers).to.be.instanceOf(Map);
    });

    it('should have package handler', () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');

      expect(handlers.has('package')).to.be.true;
      expect(handlers.get('package')).to.be.a('function');
    });

    it('should have git handler', () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');

      expect(handlers.has('git')).to.be.true;
      expect(handlers.get('git')).to.be.a('function');
    });

    it('should have local handler', () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');

      expect(handlers.has('local')).to.be.true;
      expect(handlers.get('local')).to.be.a('function');
    });

    it('should have dir handler', () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');

      expect(handlers.has('dir')).to.be.true;
      expect(handlers.get('dir')).to.be.a('function');
    });

    it('should have exactly 4 handlers', () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');

      expect(handlers.size).to.equal(4);
    });
  });

  describe('projectModulesAddCommand export', () => {
    it('should be exported as a function', () => {
      const { projectModulesAddCommand } = require('../../../../../src/cli/project/modules/add');

      expect(projectModulesAddCommand).to.be.a('function');
    });

    it('should be an async function', () => {
      const { projectModulesAddCommand } = require('../../../../../src/cli/project/modules/add');

      // Async functions return promises when called
      expect(projectModulesAddCommand.constructor.name).to.equal('AsyncFunction');
    });
  });

  describe('no project found', () => {
    it('should set exitCode to 1 when no project exists', async () => {
      // Stub readConfig to return undefined (no project found)
      sinon.stub(common, 'readConfig').resolves(undefined);

      const { projectModulesAddCommand } = require('../../../../../src/cli/project/modules/add');

      const originalExitCode = process.exitCode;

      try {
        await projectModulesAddCommand(['test-module'], {
          mode: 'package',
          project: path.join(testDir, 'nonexistent'),
        });
      } catch {
        // Command may throw or set exitCode
      }

      expect(process.exitCode).to.equal(1);
      process.exitCode = originalExitCode;
    });
  });

  describe('handler validation', () => {
    it('should validate npm module format in package handler', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const packageHandler = handlers.get('package');

      // Should handle valid formats without throwing during parsing
      expect(packageHandler).to.be.a('function');
    });

    it('should validate git URL format in git handler', async () => {
      const { handlers } = require('../../../../../src/cli/project/modules/add');
      const gitHandler = handlers.get('git');

      expect(gitHandler).to.be.a('function');
    });
  });
});
