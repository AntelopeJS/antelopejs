import { expect, sinon } from '../../../helpers/setup';
import * as common from '../../../../src/cli/common';
import * as cliUi from '../../../../src/utils/cli-ui';
import configReset from '../../../../src/cli/config/reset';

describe('cli/config/reset', () => {
  describe('reset command', () => {
    beforeEach(() => {
      sinon.stub(cliUi, 'displayBox').resolves();
      sinon.stub(cliUi, 'success');
      sinon.stub(cliUi, 'info');
    });

    it('should create reset command', () => {
      const command = configReset();

      expect(command.name()).to.equal('reset');
    });

    it('should have description', () => {
      const command = configReset();

      expect(command.description()).to.include('Reset CLI configuration to default values');
    });

    it('should have --yes option', () => {
      const command = configReset();

      const options = command.options;
      const yesOption = options.find((opt) => opt.long === '--yes');
      expect(yesOption).to.exist;
    });

    it('should not require arguments', () => {
      const command = configReset();

      expect(command.registeredArguments).to.have.length(0);
    });
  });
});
