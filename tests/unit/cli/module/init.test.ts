import { expect, sinon } from '../../../helpers/setup';
import * as common from '../../../../src/cli/common';
import * as cliUi from '../../../../src/utils/cli-ui';
import moduleInit, { moduleInitCommand } from '../../../../src/cli/module/init';

describe('cli/module/init', () => {
  describe('init command', () => {
    beforeEach(() => {
      sinon.stub(cliUi, 'displayBox').resolves();
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'error');
      sinon.stub(cliUi, 'warning');
    });

    it('should create init command', () => {
      const command = moduleInit();

      expect(command.name()).to.equal('init');
    });

    it('should have description', () => {
      const command = moduleInit();

      expect(command.description()).to.include('Create a new AntelopeJS module');
    });

    it('should require path argument', () => {
      const command = moduleInit();

      expect(command.registeredArguments).to.have.length(1);
      expect(command.registeredArguments[0].name()).to.equal('path');
    });

    it('should have git option', () => {
      const command = moduleInit();

      const options = command.options;
      const gitOption = options.find((opt) => opt.long === '--git');
      expect(gitOption).to.exist;
    });
  });

  describe('moduleInitCommand', () => {
    it('should export moduleInitCommand function', () => {
      expect(moduleInitCommand).to.be.a('function');
    });
  });
});
