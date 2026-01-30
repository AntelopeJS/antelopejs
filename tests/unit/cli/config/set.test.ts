import { expect, sinon } from '../../../helpers/setup';
import * as common from '../../../../src/cli/common';
import * as cliUi from '../../../../src/utils/cli-ui';
import configSet from '../../../../src/cli/config/set';

describe('cli/config/set', () => {
  describe('set command', () => {
    beforeEach(() => {
      sinon.stub(cliUi, 'displayBox').resolves();
      sinon.stub(cliUi, 'error');
      sinon.stub(cliUi, 'success');
    });

    it('should create set command', () => {
      const command = configSet();

      expect(command.name()).to.equal('set');
    });

    it('should have description', () => {
      const command = configSet();

      expect(command.description()).to.include('Set a CLI configuration value');
    });

    it('should accept key and value arguments', () => {
      const command = configSet();

      // Should have 2 arguments: key and value
      expect(command.registeredArguments).to.have.length(2);
    });
  });
});
