import { expect, sinon } from '../../../helpers/setup';
import * as cliUi from '../../../../src/utils/cli-ui';
import proxyquire from 'proxyquire';

describe('cli/module/test', () => {
  beforeEach(() => {
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
    sinon.stub(console, 'log');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('command structure', () => {
    it('should export a function that returns a Command', () => {
      const testCommand = require('../../../../src/cli/module/test').default;
      const command = testCommand();

      expect(command.name()).to.equal('test');
    });

    it('should have correct description', () => {
      const testCommand = require('../../../../src/cli/module/test').default;
      const command = testCommand();

      expect(command.description()).to.include('Run module tests');
    });

    it('should accept optional path argument', () => {
      const testCommand = require('../../../../src/cli/module/test').default;
      const command = testCommand();

      const args = command.registeredArguments;
      expect(args).to.have.length(1);
      expect(args[0].name()).to.equal('path');
      expect(args[0].required).to.be.false;
    });

    it('should have --file option', () => {
      const testCommand = require('../../../../src/cli/module/test').default;
      const command = testCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--file');
    });

    it('should have -f as alias for --file', () => {
      const testCommand = require('../../../../src/cli/module/test').default;
      const command = testCommand();

      const fileOption = command.options.find((o: any) => o.long === '--file');
      expect(fileOption).to.exist;
      expect(fileOption.short).to.equal('-f');
    });

    it('should parse multiple file options into an array', async () => {
      const testCommand = require('../../../../src/cli/module/test').default;
      const command = testCommand();

      // Mock the action to capture parsed options
      let parsedOptions: any;
      command.action((_path: string, opts: any) => {
        parsedOptions = opts;
      });

      await command.parseAsync(['node', 'test', '.', '-f', 'file1.ts', '-f', 'file2.ts']);

      expect(parsedOptions.file).to.be.an('array');
      expect(parsedOptions.file).to.have.length(2);
    });
  });

  describe('moduleTestCommand export', () => {
    it('should be exported as a function', () => {
      const { moduleTestCommand } = require('../../../../src/cli/module/test');

      expect(moduleTestCommand).to.be.a('function');
    });

    it('should be an async function', () => {
      const { moduleTestCommand } = require('../../../../src/cli/module/test');

      expect(moduleTestCommand.constructor.name).to.equal('AsyncFunction');
    });
  });

  describe('moduleTestCommand action', () => {
    let infoStub: sinon.SinonStub;
    let errorStub: sinon.SinonStub;
    let spinnerStartStub: sinon.SinonStub;
    let spinnerSucceedStub: sinon.SinonStub;
    let spinnerFailStub: sinon.SinonStub;
    let originalExitCode: typeof process.exitCode;

    beforeEach(() => {
      infoStub = sinon.stub();
      errorStub = sinon.stub();
      spinnerStartStub = sinon.stub().resolves();
      spinnerSucceedStub = sinon.stub().resolves();
      spinnerFailStub = sinon.stub().resolves();
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

    it('should handle invalid module directory', async () => {
      const readModuleManifestStub = sinon.stub().resolves(undefined);

      const testModule = proxyquire.noCallThru()('../../../../src/cli/module/test', {
        '../common': {
          readModuleManifest: readModuleManifestStub,
        },
        '../../utils/cli-ui': {
          info: infoStub,
          error: errorStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../..': {
          TestModule: sinon.stub(),
        },
      });

      await testModule.moduleTestCommand('/test/module', {});

      expect(spinnerFailStub).to.have.been.called;
      expect(errorStub).to.have.been.called;
      expect(infoStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
    });

    it('should run tests on valid module', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);
      const testModuleStub = sinon.stub();

      const testModule = proxyquire.noCallThru()('../../../../src/cli/module/test', {
        '../common': {
          readModuleManifest: readModuleManifestStub,
        },
        '../../utils/cli-ui': {
          info: infoStub,
          error: errorStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../..': {
          TestModule: testModuleStub,
        },
      });

      await testModule.moduleTestCommand('/test/module', {});

      expect(spinnerSucceedStub).to.have.been.called;
      expect(testModuleStub).to.have.been.called;
    });

    it('should pass file options to TestModule', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);
      const testModuleStub = sinon.stub();

      const testModule = proxyquire.noCallThru()('../../../../src/cli/module/test', {
        '../common': {
          readModuleManifest: readModuleManifestStub,
        },
        '../../utils/cli-ui': {
          info: infoStub,
          error: errorStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../..': {
          TestModule: testModuleStub,
        },
      });

      await testModule.moduleTestCommand('/test/module', { file: ['/test/file.ts'] });

      expect(testModuleStub).to.have.been.calledWith(sinon.match.string, ['/test/file.ts']);
    });

    it('should use default module path when none provided', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);
      const testModuleStub = sinon.stub();

      const testModule = proxyquire.noCallThru()('../../../../src/cli/module/test', {
        '../common': {
          readModuleManifest: readModuleManifestStub,
        },
        '../../utils/cli-ui': {
          info: infoStub,
          error: errorStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../..': {
          TestModule: testModuleStub,
        },
      });

      await testModule.moduleTestCommand(undefined, {});

      expect(readModuleManifestStub).to.have.been.called;
      expect(testModuleStub).to.have.been.called;
    });
  });
});
