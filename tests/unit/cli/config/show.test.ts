import { expect, sinon } from '../../../helpers/setup';
import * as common from '../../../../src/cli/common';
import * as cliUi from '../../../../src/utils/cli-ui';
import configShow from '../../../../src/cli/config/show';

describe('cli/config/show', () => {
  describe('show command', () => {
    beforeEach(() => {
      sinon.stub(cliUi, 'displayBox').resolves();
    });

    it('should create show command', () => {
      const command = configShow();

      expect(command.name()).to.equal('show');
    });

    it('should have description', () => {
      const command = configShow();

      expect(command.description()).to.include('Display all CLI configuration settings');
    });

    it('should not require arguments', () => {
      const command = configShow();

      expect(command.registeredArguments).to.have.length(0);
    });
  });
});
