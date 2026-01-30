import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';

describe('cli/module/imports/update', () => {
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
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      expect(command.name()).to.equal('update');
    });

    it('should have correct description', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      expect(command.description()).to.include('Update module imports');
    });

    it('should have --module option', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });

    it('should have --dry-run option', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--dry-run');
    });

    it('should have --skip-install option', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--skip-install');
    });

    it('should have -s as alias for --skip-install', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const skipInstallOption = command.options.find((o: any) => o.long === '--skip-install');
      expect(skipInstallOption).to.exist;
      expect(skipInstallOption.short).to.equal('-s');
    });
  });

  describe('option defaults', () => {
    it('should have --dry-run default to false', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const dryRunOption = command.options.find((o: any) => o.long === '--dry-run');
      expect(dryRunOption).to.exist;
      expect(dryRunOption.defaultValue).to.equal(false);
    });

    it('should have --skip-install default to false', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const skipInstallOption = command.options.find((o: any) => o.long === '--skip-install');
      expect(skipInstallOption).to.exist;
      expect(skipInstallOption.defaultValue).to.equal(false);
    });
  });

  describe('interfaces argument', () => {
    it('should accept optional interfaces argument', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('interfaces');
    });

    it('should have variadic interfaces argument', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.true;
    });

    it('should have optional interfaces argument (not required)', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      const args = command.registeredArguments;
      expect(args[0].required).to.be.false;
    });
  });

  describe('description details', () => {
    it('should mention updating in description', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      expect(command.description()).to.include('Update');
    });

    it('should mention interface definitions in description', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      expect(command.description()).to.include('interface definitions');
    });
  });

  describe('command action', () => {
    it('should have an action handler', () => {
      const updateCommand = require('../../../../../src/cli/module/imports/update').default;
      const command = updateCommand();

      expect(command._actionHandler).to.exist;
    });
  });
});
