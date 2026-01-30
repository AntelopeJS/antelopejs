import { expect, sinon } from '../../../helpers/setup';
import * as cliUi from '../../../../src/utils/cli-ui';

describe('cli/module/test', () => {
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
      const testCommand = require('../../../../src/cli/module/test').default;
      const command = testCommand();

      expect(command.name()).to.equal('test');
    });

    it('should have correct description', () => {
      const testCommand = require('../../../../src/cli/module/test').default;
      const command = testCommand();

      expect(command.description()).to.include('Run module tests');
    });

    it('should accept optional path argument', () => {
      const testCommand = require('../../../../src/cli/module/test').default;
      const command = testCommand();

      const args = command.registeredArguments;
      expect(args).to.have.length(1);
      expect(args[0].name()).to.equal('path');
      expect(args[0].required).to.be.false;
    });

    it('should have --file option', () => {
      const testCommand = require('../../../../src/cli/module/test').default;
      const command = testCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--file');
    });

    it('should have -f as alias for --file', () => {
      const testCommand = require('../../../../src/cli/module/test').default;
      const command = testCommand();

      const fileOption = command.options.find((o: any) => o.long === '--file');
      expect(fileOption).to.exist;
      expect(fileOption.short).to.equal('-f');
    });
  });

  describe('moduleTestCommand export', () => {
    it('should be exported as a function', () => {
      const { moduleTestCommand } = require('../../../../src/cli/module/test');

      expect(moduleTestCommand).to.be.a('function');
    });

    it('should be an async function', () => {
      const { moduleTestCommand } = require('../../../../src/cli/module/test');

      expect(moduleTestCommand.constructor.name).to.equal('AsyncFunction');
    });
  });
});
