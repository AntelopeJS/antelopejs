import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';
import proxyquire from 'proxyquire';
import path from 'path';
import { Options } from '../../../../../src/cli/common';

describe('cli/module/exports/set', () => {
  beforeEach(() => {
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'keyValue').callsFake((key: string, value: string | number | boolean) => `${key}: ${value}`);
    // Stub console.log to avoid output during tests
    sinon.stub(console, 'log');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('command structure', () => {
    it('should export a function that returns a Command', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      expect(command.name()).to.equal('set');
    });

    it('should have correct description', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      expect(command.description()).to.include('Set module exports path');
    });

    it('should have --module option', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });
  });

  describe('path argument', () => {
    it('should require path argument', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('path');
    });

    it('should have required path argument', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      const args = command.registeredArguments;
      expect(args[0].required).to.be.true;
    });

    it('should not be variadic', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.false;
    });
  });

  describe('option configuration', () => {
    it('should have module option with default value', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.defaultValue).to.exist;
    });
  });

  describe('description details', () => {
    it('should mention exports path in description', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      expect(command.description()).to.include('exports path');
    });

    it('should mention interfaces in description', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      expect(command.description()).to.include('interfaces');
    });
  });

  describe('command action', () => {
    it('should have an action handler', () => {
      const setCommand = require('../../../../../src/cli/module/exports/set').default;
      const command = setCommand();

      expect(command._actionHandler).to.exist;
    });
  });

  describe('module exports', () => {
    it('should export default function', () => {
      const setModule = require('../../../../../src/cli/module/exports/set');

      expect(setModule.default).to.be.a('function');
    });
  });

  describe('action function', () => {
    let displayBoxStub: sinon.SinonStub;
    let errorStub: sinon.SinonStub;
    let successStub: sinon.SinonStub;
    let originalExitCode: typeof process.exitCode;

    beforeEach(() => {
      displayBoxStub = sinon.stub().resolves();
      errorStub = sinon.stub();
      successStub = sinon.stub();
      originalExitCode = process.exitCode;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
    });

    it('should handle missing package.json', async () => {
      const readModuleManifestStub = sinon.stub().resolves(undefined);
      const writeModuleManifestStub = sinon.stub().resolves();

      const setModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/set', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          writeModuleManifest: writeModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          success: successStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = setModule.default();
      await command.parseAsync(['node', 'test', './exports', '--module', '/test/module']);

      expect(errorStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
    });

    it('should set exports path in existing manifest', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exportsPath: '/old/path',
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);
      const writeModuleManifestStub = sinon.stub().resolves();

      const setModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/set', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          writeModuleManifest: writeModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          success: successStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = setModule.default();
      await command.parseAsync(['node', 'test', './exports', '--module', '/test/module']);

      expect(writeModuleManifestStub).to.have.been.calledOnce;
      expect(successStub).to.have.been.called;
      expect(displayBoxStub).to.have.been.called;
    });

    it('should create antelopeJs object if not present', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);
      const writeModuleManifestStub = sinon.stub().resolves();

      const setModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/set', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          writeModuleManifest: writeModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          success: successStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = setModule.default();
      await command.parseAsync(['node', 'test', './exports', '--module', '/test/module']);

      expect(writeModuleManifestStub).to.have.been.calledOnce;
      const writtenManifest = writeModuleManifestStub.firstCall.args[1];
      expect(writtenManifest.antelopeJs).to.exist;
      expect(writtenManifest.antelopeJs.imports).to.deep.equal([]);
      expect(writtenManifest.antelopeJs.importsOptional).to.deep.equal([]);
    });

    it('should handle missing exportsPath displaying "(not set)"', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);
      const writeModuleManifestStub = sinon.stub().resolves();
      let displayBoxContent = '';

      const setModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/set', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          writeModuleManifest: writeModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: (content: string) => {
            displayBoxContent = content;
            return Promise.resolve();
          },
          error: errorStub,
          success: successStub,
          keyValue: (key: string, value: string) => `${key}: ${value}`,
        },
      });

      const command = setModule.default();
      await command.parseAsync(['node', 'test', './exports', '--module', '/test/module']);

      expect(displayBoxContent).to.include('(not set)');
    });
  });
});
