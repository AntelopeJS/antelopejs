import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';

describe('cli/module/imports/install', () => {
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
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      expect(command.name()).to.equal('install');
    });

    it('should have correct description', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      expect(command.description()).to.include('Install missing interfaces');
    });

    it('should have --module option', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });
  });

  describe('option configuration', () => {
    it('should have module option with default value', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.defaultValue).to.exist;
    });

    it('should have module option with argument parser', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.argChoices).to.be.undefined; // Not using choices
    });
  });

  describe('command action', () => {
    it('should have an action handler', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      // Commander stores action handlers internally
      expect(command._actionHandler).to.exist;
    });
  });

  describe('description details', () => {
    it('should mention .antelope directory in description', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      expect(command.description()).to.include('.antelope');
    });

    it('should mention package.json in description', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      expect(command.description()).to.include('package.json');
    });

    it('should mention interfaces.d in description', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      expect(command.description()).to.include('interfaces.d');
    });
  });

  describe('no arguments required', () => {
    it('should not require any arguments', () => {
      const installCommand = require('../../../../../src/cli/module/imports/install').default;
      const command = installCommand();

      const args = command.registeredArguments;
      expect(args.length).to.equal(0);
    });
  });
});
