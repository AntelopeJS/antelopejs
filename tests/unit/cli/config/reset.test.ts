import { expect, sinon } from '../../../helpers/setup';
import * as common from '../../../../src/cli/common';
import * as cliUi from '../../../../src/utils/cli-ui';
import configReset from '../../../../src/cli/config/reset';
import proxyquire from 'proxyquire';

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

  describe('action function', () => {
    let displayBoxStub: sinon.SinonStub;
    let successStub: sinon.SinonStub;
    let infoStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;

    beforeEach(() => {
      displayBoxStub = sinon.stub(cliUi, 'displayBox').resolves();
      successStub = sinon.stub(cliUi, 'success');
      infoStub = sinon.stub(cliUi, 'info');
      consoleLogStub = sinon.stub(console, 'log');
    });

    it('should show info when config is already at defaults', async () => {
      const defaultConfig = { git: 'https://github.com/AntelopeJS/interfaces.git' };
      const readUserConfigStub = sinon.stub().resolves(defaultConfig);
      const getDefaultUserConfigStub = sinon.stub().returns(defaultConfig);
      const writeUserConfigStub = sinon.stub().resolves();

      const configResetModule = proxyquire.noCallThru()('../../../../src/cli/config/reset', {
        '../common': {
          readUserConfig: readUserConfigStub,
          getDefaultUserConfig: getDefaultUserConfigStub,
          writeUserConfig: writeUserConfigStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          success: successStub,
          info: infoStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configResetModule.default();
      await command.parseAsync(['node', 'test']);

      expect(infoStub).to.have.been.called;
      expect(writeUserConfigStub).to.not.have.been.called;
    });

    it('should reset config when --yes flag is provided', async () => {
      const currentConfig = { git: 'https://github.com/custom/repo.git' };
      const defaultConfig = { git: 'https://github.com/AntelopeJS/interfaces.git' };
      const readUserConfigStub = sinon.stub().resolves(currentConfig);
      const getDefaultUserConfigStub = sinon.stub().returns(defaultConfig);
      const writeUserConfigStub = sinon.stub().resolves();

      const configResetModule = proxyquire.noCallThru()('../../../../src/cli/config/reset', {
        '../common': {
          readUserConfig: readUserConfigStub,
          getDefaultUserConfig: getDefaultUserConfigStub,
          writeUserConfig: writeUserConfigStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          success: successStub,
          info: infoStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configResetModule.default();
      await command.parseAsync(['node', 'test', '--yes']);

      expect(writeUserConfigStub).to.have.been.calledWith(defaultConfig);
      expect(successStub).to.have.been.called;
      expect(displayBoxStub).to.have.been.called;
    });

    // Tests involving inquirer confirmation are skipped because the source code uses
    // dynamic import for inquirer which is difficult to mock with proxyquire.
    // The --yes flag path is tested above which covers the main reset logic.
  });
});
