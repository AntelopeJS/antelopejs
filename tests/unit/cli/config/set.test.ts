import { expect, sinon } from '../../../helpers/setup';
import * as common from '../../../../src/cli/common';
import * as cliUi from '../../../../src/utils/cli-ui';
import configSet from '../../../../src/cli/config/set';
import proxyquire from 'proxyquire';

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

  describe('action function', () => {
    let displayBoxStub: sinon.SinonStub;
    let errorStub: sinon.SinonStub;
    let successStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;
    let originalExitCode: typeof process.exitCode;

    beforeEach(() => {
      displayBoxStub = sinon.stub(cliUi, 'displayBox').resolves();
      errorStub = sinon.stub(cliUi, 'error');
      successStub = sinon.stub(cliUi, 'success');
      consoleLogStub = sinon.stub(console, 'log');
      originalExitCode = process.exitCode;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
    });

    it('should handle invalid config key', async () => {
      const readUserConfigStub = sinon.stub().resolves({ git: 'https://github.com/test/repo.git' });
      const writeUserConfigStub = sinon.stub().resolves();

      const configSetModule = proxyquire.noCallThru()('../../../../src/cli/config/set', {
        '../common': {
          readUserConfig: readUserConfigStub,
          writeUserConfig: writeUserConfigStub,
          DEFAULT_GIT_REPO: 'https://github.com/AntelopeJS/interfaces.git',
          displayNonDefaultGitWarning: sinon.stub().resolves(),
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          success: successStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configSetModule.default();
      await command.parseAsync(['node', 'test', 'invalid-key', 'value']);

      expect(errorStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
      expect(writeUserConfigStub).to.not.have.been.called;
    });

    it('should set git config value', async () => {
      const currentConfig = { git: 'https://github.com/test/repo.git' };
      const readUserConfigStub = sinon.stub().resolves(currentConfig);
      const writeUserConfigStub = sinon.stub().resolves();
      const displayNonDefaultGitWarningStub = sinon.stub().resolves();

      const configSetModule = proxyquire.noCallThru()('../../../../src/cli/config/set', {
        '../common': {
          readUserConfig: readUserConfigStub,
          writeUserConfig: writeUserConfigStub,
          DEFAULT_GIT_REPO: 'https://github.com/AntelopeJS/interfaces.git',
          displayNonDefaultGitWarning: displayNonDefaultGitWarningStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          success: successStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configSetModule.default();
      await command.parseAsync(['node', 'test', 'git', 'https://github.com/new/repo.git']);

      expect(writeUserConfigStub).to.have.been.calledOnce;
      expect(successStub).to.have.been.called;
      expect(displayBoxStub).to.have.been.called;
    });

    it('should display warning for non-default git repo', async () => {
      const currentConfig = { git: 'https://github.com/AntelopeJS/interfaces.git' };
      const readUserConfigStub = sinon.stub().resolves(currentConfig);
      const writeUserConfigStub = sinon.stub().resolves();
      const displayNonDefaultGitWarningStub = sinon.stub().resolves();

      const configSetModule = proxyquire.noCallThru()('../../../../src/cli/config/set', {
        '../common': {
          readUserConfig: readUserConfigStub,
          writeUserConfig: writeUserConfigStub,
          DEFAULT_GIT_REPO: 'https://github.com/AntelopeJS/interfaces.git',
          displayNonDefaultGitWarning: displayNonDefaultGitWarningStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          success: successStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configSetModule.default();
      await command.parseAsync(['node', 'test', 'git', 'https://github.com/custom/repo.git']);

      expect(displayNonDefaultGitWarningStub).to.have.been.calledWith('https://github.com/custom/repo.git');
    });

    it('should not display warning for default git repo', async () => {
      const currentConfig = { git: 'https://github.com/test/repo.git' };
      const readUserConfigStub = sinon.stub().resolves(currentConfig);
      const writeUserConfigStub = sinon.stub().resolves();
      const displayNonDefaultGitWarningStub = sinon.stub().resolves();

      const configSetModule = proxyquire.noCallThru()('../../../../src/cli/config/set', {
        '../common': {
          readUserConfig: readUserConfigStub,
          writeUserConfig: writeUserConfigStub,
          DEFAULT_GIT_REPO: 'https://github.com/AntelopeJS/interfaces.git',
          displayNonDefaultGitWarning: displayNonDefaultGitWarningStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          success: successStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configSetModule.default();
      await command.parseAsync(['node', 'test', 'git', 'https://github.com/AntelopeJS/interfaces.git']);

      expect(displayNonDefaultGitWarningStub).to.not.have.been.called;
    });
  });
});
