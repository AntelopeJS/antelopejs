import { expect, sinon } from '../../../helpers/setup';
import * as common from '../../../../src/cli/common';
import * as cliUi from '../../../../src/utils/cli-ui';
import configGet from '../../../../src/cli/config/get';
import proxyquire from 'proxyquire';

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

  describe('action function', () => {
    let displayBoxStub: sinon.SinonStub;
    let errorStub: sinon.SinonStub;
    let warningStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;
    let originalExitCode: typeof process.exitCode;

    beforeEach(() => {
      displayBoxStub = sinon.stub(cliUi, 'displayBox').resolves();
      errorStub = sinon.stub(cliUi, 'error');
      warningStub = sinon.stub(cliUi, 'warning');
      consoleLogStub = sinon.stub(console, 'log');
      originalExitCode = process.exitCode;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
    });

    it('should display valid config key value', async () => {
      const readUserConfigStub = sinon.stub().resolves({ git: 'https://github.com/test/repo.git' });

      const configGetModule = proxyquire.noCallThru()('../../../../src/cli/config/get', {
        '../common': {
          readUserConfig: readUserConfigStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configGetModule.default();
      await command.parseAsync(['node', 'test', 'git']);

      expect(readUserConfigStub).to.have.been.calledOnce;
      expect(displayBoxStub).to.have.been.calledOnce;
    });

    it('should handle invalid config key', async () => {
      const readUserConfigStub = sinon.stub().resolves({ git: 'https://github.com/test/repo.git' });

      const configGetModule = proxyquire.noCallThru()('../../../../src/cli/config/get', {
        '../common': {
          readUserConfig: readUserConfigStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configGetModule.default();
      await command.parseAsync(['node', 'test', 'invalid-key']);

      expect(errorStub).to.have.been.called;
      expect(warningStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
    });

    it('should handle config key not found in config object', async () => {
      // Return an empty config that doesn't have the 'git' key
      const readUserConfigStub = sinon.stub().resolves({});

      const configGetModule = proxyquire.noCallThru()('../../../../src/cli/config/get', {
        '../common': {
          readUserConfig: readUserConfigStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configGetModule.default();
      await command.parseAsync(['node', 'test', 'git']);

      expect(errorStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
    });

    it('should display not set for undefined value', async () => {
      const readUserConfigStub = sinon.stub().resolves({ git: undefined });

      const configGetModule = proxyquire.noCallThru()('../../../../src/cli/config/get', {
        '../common': {
          readUserConfig: readUserConfigStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configGetModule.default();
      await command.parseAsync(['node', 'test', 'git']);

      expect(displayBoxStub).to.have.been.calledOnce;
    });
  });
});
