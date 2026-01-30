import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';

describe('cli/module/exports/set', () => {
  beforeEach(() => {
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'keyValue').callsFake((key: string, value: string | number | boolean) => `${key}: ${value}`);
    // Stub console.log to avoid output during tests
    sinon.stub(console, 'log');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('command structure', () => {
    it('should export a function that returns a Command', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      expect(command.name()).to.equal('set');
    });

    it('should have correct description', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      expect(command.description()).to.include('Set module exports path');
    });

    it('should have --module option', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });
  });

  describe('path argument', () => {
    it('should require path argument', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('path');
    });

    it('should have required path argument', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      const args = command.registeredArguments;
      expect(args[0].required).to.be.true;
    });

    it('should not be variadic', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.false;
    });
  });

  describe('option configuration', () => {
    it('should have module option with default value', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.defaultValue).to.exist;
    });
  });

  describe('description details', () => {
    it('should mention exports path in description', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      expect(command.description()).to.include('exports path');
    });

    it('should mention interfaces in description', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      expect(command.description()).to.include('interfaces');
    });
  });

  describe('command action', () => {
    it('should have an action handler', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      expect(command._actionHandler).to.exist;
    });
  });

  describe('module exports', () => {
    it('should export default function', () => {
      const setModule = require('../../../../../src/cli/module/exports/set');

      expect(setModule.default).to.be.a('function');
    });
  });
});
