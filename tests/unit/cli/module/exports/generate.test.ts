import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';

describe('cli/module/exports/generate', () => {
  beforeEach(() => {
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'displayBox').resolves();
    // Stub console.log to avoid output during tests
    sinon.stub(console, 'log');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('command structure', () => {
    it('should export a function that returns a Command', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      expect(command.name()).to.equal('generate');
    });

    it('should have correct description', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      expect(command.description()).to.include('Generate module exports');
    });

    it('should have --module option', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });
  });

  describe('option configuration', () => {
    it('should have module option with default value', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.defaultValue).to.exist;
    });
  });

  describe('description details', () => {
    it('should mention TypeScript definition in description', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      expect(command.description()).to.include('TypeScript definition');
    });

    it('should mention exports in description', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      expect(command.description()).to.include('exports');
    });
  });

  describe('no arguments required', () => {
    it('should not require any arguments', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      const args = command.registeredArguments;
      expect(args.length).to.equal(0);
    });
  });

  describe('command action', () => {
    it('should have an action handler', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      expect(command._actionHandler).to.exist;
    });
  });

  describe('module exports', () => {
    it('should export default function', () => {
      const generateModule = require('../../../../../src/cli/module/exports/generate');

      expect(generateModule.default).to.be.a('function');
    });
  });
});
