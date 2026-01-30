import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';

describe('cli/module/imports/list', () => {
  beforeEach(() => {
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'displayBox').resolves();
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
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      expect(command.name()).to.equal('list');
    });

    it('should have correct description', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      expect(command.description()).to.include('List all imports');
    });

    it('should have ls alias', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      expect(command.aliases()).to.include('ls');
    });

    it('should have --module option', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });

    it('should have --verbose option', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--verbose');
    });

    it('should have -v as alias for --verbose', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      const verboseOption = command.options.find((o: any) => o.long === '--verbose');
      expect(verboseOption).to.exist;
      expect(verboseOption.short).to.equal('-v');
    });
  });

  describe('option defaults', () => {
    it('should have --verbose default to false', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      const verboseOption = command.options.find((o: any) => o.long === '--verbose');
      expect(verboseOption).to.exist;
      expect(verboseOption.defaultValue).to.equal(false);
    });
  });

  describe('command does not take arguments', () => {
    it('should not have any required arguments', () => {
      const listCommand = require('../../../../../src/cli/module/imports/list').default;
      const command = listCommand();

      const args = command.registeredArguments;
      expect(args.length).to.equal(0);
    });
  });
});
