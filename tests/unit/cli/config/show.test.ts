import { expect, sinon } from '../../../helpers/setup';
import * as common from '../../../../src/cli/common';
import * as cliUi from '../../../../src/utils/cli-ui';
import configShow from '../../../../src/cli/config/show';
import proxyquire from 'proxyquire';

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

  describe('action function', () => {
    let displayBoxStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;

    beforeEach(() => {
      displayBoxStub = sinon.stub(cliUi, 'displayBox').resolves();
      consoleLogStub = sinon.stub(console, 'log');
    });

    it('should display config values', async () => {
      const config = { git: 'https://github.com/test/repo.git' };
      const readUserConfigStub = sinon.stub().resolves(config);

      const configShowModule = proxyquire.noCallThru()('../../../../src/cli/config/show', {
        '../common': {
          readUserConfig: readUserConfigStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configShowModule.default();
      await command.parseAsync(['node', 'test']);

      expect(readUserConfigStub).to.have.been.calledOnce;
      expect(displayBoxStub).to.have.been.calledOnce;
    });

    it('should display empty config', async () => {
      const config = {};
      const readUserConfigStub = sinon.stub().resolves(config);

      const configShowModule = proxyquire.noCallThru()('../../../../src/cli/config/show', {
        '../common': {
          readUserConfig: readUserConfigStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configShowModule.default();
      await command.parseAsync(['node', 'test']);

      expect(displayBoxStub).to.have.been.calledOnce;
    });

    it('should handle undefined values in config', async () => {
      const config = { git: undefined };
      const readUserConfigStub = sinon.stub().resolves(config);

      const configShowModule = proxyquire.noCallThru()('../../../../src/cli/config/show', {
        '../common': {
          readUserConfig: readUserConfigStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = configShowModule.default();
      await command.parseAsync(['node', 'test']);

      expect(displayBoxStub).to.have.been.calledOnce;
    });

    it('should display multiple config values', async () => {
      const config = { git: 'https://github.com/test/repo.git', otherKey: 'otherValue' };
      const readUserConfigStub = sinon.stub().resolves(config);
      let keyValueCalls = 0;

      const configShowModule = proxyquire.noCallThru()('../../../../src/cli/config/show', {
        '../common': {
          readUserConfig: readUserConfigStub,
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          keyValue: (key: string, value: string) => {
            keyValueCalls++;
            return `${key}: ${value}`;
          },
        },
      });

      const command = configShowModule.default();
      await command.parseAsync(['node', 'test']);

      expect(keyValueCalls).to.equal(2);
    });
  });
});
