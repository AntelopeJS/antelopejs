import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';

describe('cli/module/imports/add', () => {
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
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      expect(command.name()).to.equal('add');
    });

    it('should have correct description', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      expect(command.description()).to.include('Add interfaces to your module');
    });

    it('should have --module option', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });

    it('should have --git option', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--git');
    });

    it('should have -g as alias for --git', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const gitOption = command.options.find((o: any) => o.long === '--git');
      expect(gitOption).to.exist;
      expect(gitOption.short).to.equal('-g');
    });

    it('should have --optional flag', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--optional');
    });

    it('should have -o as alias for --optional', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const optionalOption = command.options.find((o: any) => o.long === '--optional');
      expect(optionalOption).to.exist;
      expect(optionalOption.short).to.equal('-o');
    });

    it('should have --skip-install flag', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--skip-install');
    });

    it('should have -s as alias for --skip-install', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const skipInstallOption = command.options.find((o: any) => o.long === '--skip-install');
      expect(skipInstallOption).to.exist;
      expect(skipInstallOption.short).to.equal('-s');
    });

    it('should require interfaces argument', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('interfaces');
    });

    it('should accept variadic interfaces argument', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.true;
    });

    it('should have required interfaces argument', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const args = command.registeredArguments;
      expect(args[0].required).to.be.true;
    });
  });

  describe('option defaults', () => {
    it('should have --optional default to false', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const optionalOption = command.options.find((o: any) => o.long === '--optional');
      expect(optionalOption).to.exist;
      expect(optionalOption.defaultValue).to.equal(false);
    });

    it('should have --skip-install default to false', () => {
      const addCommand = require('../../../../../src/cli/module/imports/add').default;
      const command = addCommand();

      const skipInstallOption = command.options.find((o: any) => o.long === '--skip-install');
      expect(skipInstallOption).to.exist;
      expect(skipInstallOption.defaultValue).to.equal(false);
    });
  });

  describe('moduleImportAddCommand export', () => {
    it('should be exported as a function', () => {
      const { moduleImportAddCommand } = require('../../../../../src/cli/module/imports/add');

      expect(moduleImportAddCommand).to.be.a('function');
    });

    it('should be an async function', () => {
      const { moduleImportAddCommand } = require('../../../../../src/cli/module/imports/add');

      expect(moduleImportAddCommand.constructor.name).to.equal('AsyncFunction');
    });
  });
});
