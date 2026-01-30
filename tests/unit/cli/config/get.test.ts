import { expect, sinon } from '../../../helpers/setup';
import * as common from '../../../../src/cli/common';
import * as cliUi from '../../../../src/utils/cli-ui';
import configGet from '../../../../src/cli/config/get';

describe('cli/config/get', () => {
  describe('get command', () => {
    beforeEach(() => {
      sinon.stub(cliUi, 'displayBox').resolves();
      sinon.stub(cliUi, 'error');
      sinon.stub(cliUi, 'warning');
    });

    it('should create get command', () => {
      const command = configGet();

      expect(command.name()).to.equal('get');
    });

    it('should have description', () => {
      const command = configGet();

      expect(command.description()).to.include('Get a specific CLI configuration value');
    });

    it('should accept key argument', () => {
      const command = configGet();

      expect(command.registeredArguments).to.have.length.greaterThan(0);
    });
  });
});
