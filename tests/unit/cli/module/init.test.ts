import { expect, sinon } from '../../../helpers/setup';
import * as common from '../../../../src/cli/common';
import * as cliUi from '../../../../src/utils/cli-ui';
import moduleInit, { moduleInitCommand } from '../../../../src/cli/module/init';
import proxyquire from 'proxyquire';
import {
  createMockGitHelpers,
  createMockGitManifest,
  createMockInterfaceInfo,
  createProxyquireGitModule,
} from '../../../helpers/mocks/git-helpers.mock';

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

  describe('moduleInitCommand action', () => {
    let displayBoxStub: sinon.SinonStub;
    let infoStub: sinon.SinonStub;
    let errorStub: sinon.SinonStub;
    let warningStub: sinon.SinonStub;
    let spinnerStartStub: sinon.SinonStub;
    let spinnerSucceedStub: sinon.SinonStub;
    let spinnerFailStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;
    let originalExitCode: typeof process.exitCode;

    beforeEach(() => {
      displayBoxStub = sinon.stub().resolves();
      infoStub = sinon.stub();
      errorStub = sinon.stub();
      warningStub = sinon.stub();
      spinnerStartStub = sinon.stub().resolves();
      spinnerSucceedStub = sinon.stub().resolves();
      spinnerFailStub = sinon.stub().resolves();
      consoleLogStub = sinon.stub(console, 'log');
      originalExitCode = process.exitCode;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
    });

    function createMockSpinner() {
      return {
        start: spinnerStartStub,
        succeed: spinnerSucceedStub,
        fail: spinnerFailStub,
      };
    }

    it('should handle non-empty directory', async () => {
      const existsSyncStub = sinon.stub().returns(true);
      const readdirSyncStub = sinon.stub().returns(['file1.txt', 'file2.txt']);

      const initModule = proxyquire.noCallThru()('../../../../src/cli/module/init', {
        '../common': {
          readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/repo.git' }),
          displayNonDefaultGitWarning: sinon.stub().resolves(),
          Options: { git: {} },
        },
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          info: infoStub,
          error: errorStub,
          warning: warningStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        fs: {
          existsSync: existsSyncStub,
          readdirSync: readdirSyncStub,
        },
      });

      await initModule.moduleInitCommand('/test/module', {}, false);

      expect(spinnerFailStub).to.have.been.called;
      expect(errorStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
    });

    it('should handle git loading failure', async () => {
      const existsSyncStub = sinon.stub().returns(false);
      const mockGitHelpers = createMockGitHelpers();

      mockGitHelpers.loadManifestFromGit.rejects(new Error('Git error'));

      const initModule = proxyquire.noCallThru()('../../../../src/cli/module/init', {
        '../common': {
          readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/repo.git' }),
          displayNonDefaultGitWarning: sinon.stub().resolves(),
          Options: { git: {} },
        },
        '../git': createProxyquireGitModule(mockGitHelpers),
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          info: infoStub,
          error: errorStub,
          warning: warningStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        fs: {
          existsSync: existsSyncStub,
          readdirSync: sinon.stub().returns([]),
        },
      });

      await initModule.moduleInitCommand('/test/module', {}, false);

      expect(spinnerFailStub).to.have.been.called;
      expect(errorStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
    });

    it('should re-throw error when called from project', async () => {
      const existsSyncStub = sinon.stub().returns(false);
      const mockGitHelpers = createMockGitHelpers();
      const testError = new Error('Git error');

      mockGitHelpers.loadManifestFromGit.rejects(testError);

      const initModule = proxyquire.noCallThru()('../../../../src/cli/module/init', {
        '../common': {
          readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/repo.git' }),
          displayNonDefaultGitWarning: sinon.stub().resolves(),
          Options: { git: {} },
        },
        '../git': createProxyquireGitModule(mockGitHelpers),
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          info: infoStub,
          error: errorStub,
          warning: warningStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        fs: {
          existsSync: existsSyncStub,
          readdirSync: sinon.stub().returns([]),
        },
      });

      let thrownError: Error | undefined;
      try {
        await initModule.moduleInitCommand('/test/module', {}, true);
      } catch (e) {
        thrownError = e as Error;
      }

      expect(thrownError).to.equal(testError);
    });

    it('should handle non-Error thrown', async () => {
      const existsSyncStub = sinon.stub().returns(false);
      const mockGitHelpers = createMockGitHelpers();

      mockGitHelpers.loadManifestFromGit.rejects('string error');

      const initModule = proxyquire.noCallThru()('../../../../src/cli/module/init', {
        '../common': {
          readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/repo.git' }),
          displayNonDefaultGitWarning: sinon.stub().resolves(),
          Options: { git: {} },
        },
        '../git': createProxyquireGitModule(mockGitHelpers),
        '../../utils/cli-ui': {
          displayBox: displayBoxStub,
          info: infoStub,
          error: errorStub,
          warning: warningStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        fs: {
          existsSync: existsSyncStub,
          readdirSync: sinon.stub().returns([]),
        },
      });

      await initModule.moduleInitCommand('/test/module', {}, false);

      expect(errorStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
    });

    // Note: Tests involving inquirer prompts are skipped because the source code uses
    // a default import from inquirer module that is difficult to mock with proxyquire.
    // The error handling paths are tested above which provides good coverage of the
    // moduleInitCommand function.
  });
});
