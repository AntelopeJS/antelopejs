import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';

describe('cli/module/imports/remove', () => {
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
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      expect(command.name()).to.equal('remove');
    });

    it('should have correct description', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      expect(command.description()).to.include('Remove imported interfaces');
    });

    it('should have rm alias', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      expect(command.aliases()).to.include('rm');
    });

    it('should have --module option', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });

    it('should require interfaces argument', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('interfaces');
    });

    it('should accept variadic interfaces argument', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.true;
    });

    it('should have required interfaces argument', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      const args = command.registeredArguments;
      expect(args[0].required).to.be.true;
    });
  });

  describe('command options count', () => {
    it('should have exactly one option (--module)', () => {
      const removeCommand = require('../../../../../src/cli/module/imports/remove').default;
      const command = removeCommand();

      // Should only have the --module option
      expect(command.options.length).to.equal(1);
    });
  });
});
