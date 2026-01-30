import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';
import proxyquire from 'proxyquire';
import { Options } from '../../../../../src/cli/common';

describe('cli/module/exports/generate', () => {
  beforeEach(() => {
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'displayBox').resolves();
    // Stub console.log to avoid output during tests
    sinon.stub(console, 'log');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('command structure', () => {
    it('should export a function that returns a Command', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      expect(command.name()).to.equal('generate');
    });

    it('should have correct description', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      expect(command.description()).to.include('Generate module exports');
    });

    it('should have --module option', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--module');
    });

    it('should have -m as alias for --module', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.short).to.equal('-m');
    });
  });

  describe('option configuration', () => {
    it('should have module option with default value', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      const moduleOption = command.options.find((o: any) => o.long === '--module');
      expect(moduleOption).to.exist;
      expect(moduleOption.defaultValue).to.exist;
    });
  });

  describe('description details', () => {
    it('should mention TypeScript definition in description', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      expect(command.description()).to.include('TypeScript definition');
    });

    it('should mention exports in description', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      expect(command.description()).to.include('exports');
    });
  });

  describe('no arguments required', () => {
    it('should not require any arguments', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      const args = command.registeredArguments;
      expect(args.length).to.equal(0);
    });
  });

  describe('command action', () => {
    it('should have an action handler', () => {
      const generateCommand = require('../../../../../src/cli/module/exports/generate').default;
      const command = generateCommand();

      expect(command._actionHandler).to.exist;
    });
  });

  describe('module exports', () => {
    it('should export default function', () => {
      const generateModule = require('../../../../../src/cli/module/exports/generate');

      expect(generateModule.default).to.be.a('function');
    });
  });

  describe('action function', () => {
    let displayBoxStub: sinon.SinonStub;
    let errorStub: sinon.SinonStub;
    let warningStub: sinon.SinonStub;
    let infoStub: sinon.SinonStub;
    let spinnerStartStub: sinon.SinonStub;
    let spinnerSucceedStub: sinon.SinonStub;
    let spinnerFailStub: sinon.SinonStub;
    let originalExitCode: typeof process.exitCode;

    beforeEach(() => {
      displayBoxStub = sinon.stub().resolves();
      errorStub = sinon.stub();
      warningStub = sinon.stub();
      infoStub = sinon.stub();
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

    it('should handle missing package.json', async () => {
      const readModuleManifestStub = sinon.stub().resolves(undefined);

      const generateModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/generate', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          info: infoStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../../../common/cache': {
          ModuleCache: {
            getTemp: sinon.stub().resolves('/tmp/test'),
          },
        },
      });

      const command = generateModule.default();
      await command.parseAsync(['node', 'test', '--module', '/test/module']);

      expect(errorStub).to.have.been.called;
    });

    it('should handle missing exports path in manifest', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);

      const generateModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/generate', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          info: infoStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../../../common/cache': {
          ModuleCache: {
            getTemp: sinon.stub().resolves('/tmp/test'),
          },
        },
      });

      const command = generateModule.default();
      await command.parseAsync(['node', 'test', '--module', '/test/module']);

      expect(errorStub).to.have.been.called;
      expect(warningStub).to.have.been.called;
    });

    it('should handle clean output directory failure', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exportsPath: './exports',
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);

      // Simulate stat returning true (directory exists) but rm failing
      const statStub = sinon.stub();
      statStub.resolves({ isDirectory: () => true });
      const rmStub = sinon.stub().rejects(new Error('Permission denied'));

      const generateModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/generate', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          info: infoStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../../../common/cache': {
          ModuleCache: {
            getTemp: sinon.stub().resolves('/tmp/test'),
          },
        },
        'fs/promises': {
          stat: statStub,
          rm: rmStub,
          mkdir: sinon.stub().resolves(),
          readFile: sinon.stub().resolves('{}'),
        },
      });

      const command = generateModule.default();
      await command.parseAsync(['node', 'test', '--module', '/test/module']);

      expect(spinnerFailStub).to.have.been.called;
    });

    it('should handle TypeScript compilation failure', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exportsPath: './exports',
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);

      // Simulate stat returning false (directory doesn't exist)
      const statStub = sinon.stub();
      statStub.callsFake(() => Promise.reject({ code: 'ENOENT' }));

      const executeCMDStub = sinon.stub().resolves({ code: 1, stderr: 'TypeScript compilation error' });

      const generateModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/generate', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          info: infoStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../../../common/cache': {
          ModuleCache: {
            getTemp: sinon.stub().resolves('/tmp/test'),
          },
        },
        '../../../utils/command': {
          ExecuteCMD: executeCMDStub,
        },
        'fs/promises': {
          stat: statStub,
          rm: sinon.stub().resolves(),
          mkdir: sinon.stub().resolves(),
          readFile: sinon.stub().resolves('{}'),
        },
      });

      const command = generateModule.default();
      await command.parseAsync(['node', 'test', '--module', '/test/module']);

      expect(spinnerFailStub).to.have.been.called;
      expect(errorStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
    });

    it('should handle missing outDir in tsconfig', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exportsPath: './exports',
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);

      // Simulate stat returning false (directory doesn't exist)
      const statStub = sinon.stub();
      statStub.callsFake(() => Promise.reject({ code: 'ENOENT' }));

      const executeCMDStub = sinon.stub().resolves({ code: 0, stderr: '' });

      // Return tsconfig without outDir
      const readFileStub = sinon.stub().resolves(JSON.stringify({ compilerOptions: {} }));

      const generateModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/generate', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          info: infoStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../../../common/cache': {
          ModuleCache: {
            getTemp: sinon.stub().resolves('/tmp/test'),
          },
        },
        '../../../utils/command': {
          ExecuteCMD: executeCMDStub,
        },
        'fs/promises': {
          stat: statStub,
          rm: sinon.stub().resolves(),
          mkdir: sinon.stub().resolves(),
          readFile: readFileStub,
        },
      });

      const command = generateModule.default();
      await command.parseAsync(['node', 'test', '--module', '/test/module']);

      expect(spinnerFailStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
    });

    it('should handle tsconfig read error', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exportsPath: './exports',
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);

      // Simulate stat returning false (directory doesn't exist)
      const statStub = sinon.stub();
      statStub.callsFake(() => Promise.reject({ code: 'ENOENT' }));

      const executeCMDStub = sinon.stub().resolves({ code: 0, stderr: '' });

      // Return invalid JSON for tsconfig
      const readFileStub = sinon.stub().resolves('invalid json');

      const generateModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/generate', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          info: infoStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../../../common/cache': {
          ModuleCache: {
            getTemp: sinon.stub().resolves('/tmp/test'),
          },
        },
        '../../../utils/command': {
          ExecuteCMD: executeCMDStub,
        },
        'fs/promises': {
          stat: statStub,
          rm: sinon.stub().resolves(),
          mkdir: sinon.stub().resolves(),
          readFile: readFileStub,
        },
      });

      const command = generateModule.default();
      await command.parseAsync(['node', 'test', '--module', '/test/module']);

      expect(errorStub).to.have.been.called;
    });

    it('should handle command exception', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exportsPath: './exports',
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);

      // Simulate stat returning false (directory doesn't exist)
      const statStub = sinon.stub();
      statStub.callsFake(() => Promise.reject({ code: 'ENOENT' }));

      const executeCMDStub = sinon.stub().rejects(new Error('Command failed'));

      const generateModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/generate', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          info: infoStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../../../common/cache': {
          ModuleCache: {
            getTemp: sinon.stub().resolves('/tmp/test'),
          },
        },
        '../../../utils/command': {
          ExecuteCMD: executeCMDStub,
        },
        'fs/promises': {
          stat: statStub,
          rm: sinon.stub().resolves(),
          mkdir: sinon.stub().resolves(),
          readFile: sinon.stub().resolves(JSON.stringify({ compilerOptions: { outDir: './dist' } })),
        },
      });

      const command = generateModule.default();
      await command.parseAsync(['node', 'test', '--module', '/test/module']);

      expect(spinnerFailStub).to.have.been.called;
      expect(displayBoxStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
    });

    it('should handle move interface files failure', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exportsPath: './exports',
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);

      // Simulate stat returning false (directory doesn't exist) first, then true for interface folder
      const statStub = sinon.stub();
      statStub.onFirstCall().rejects({ code: 'ENOENT' });
      statStub.onSecondCall().resolves({ isDirectory: () => true });

      // First executeCMD call succeeds (tsc), second fails (cp)
      const executeCMDStub = sinon.stub();
      executeCMDStub.onFirstCall().resolves({ code: 0, stderr: '' });
      executeCMDStub.onSecondCall().resolves({ code: 1, stderr: 'copy failed' });

      const generateModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/generate', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          info: infoStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../../../common/cache': {
          ModuleCache: {
            getTemp: sinon.stub().resolves('/tmp/test'),
          },
        },
        '../../../utils/command': {
          ExecuteCMD: executeCMDStub,
        },
        'fs/promises': {
          stat: statStub,
          rm: sinon.stub().resolves(),
          mkdir: sinon.stub().resolves(),
          readFile: sinon.stub().resolves(JSON.stringify({ compilerOptions: { outDir: './dist' } })),
        },
      });

      const command = generateModule.default();
      await command.parseAsync(['node', 'test', '--module', '/test/module']);

      expect(spinnerFailStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
    });

    it('should handle invalid tsconfig format (not an object)', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exportsPath: './exports',
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);

      // Simulate stat returning false (directory doesn't exist)
      const statStub = sinon.stub();
      statStub.callsFake(() => Promise.reject({ code: 'ENOENT' }));

      const executeCMDStub = sinon.stub().resolves({ code: 0, stderr: '' });

      // Return tsconfig that is not a valid object (null or primitive)
      const readFileStub = sinon.stub().resolves('null');

      const generateModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/generate', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          info: infoStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../../../common/cache': {
          ModuleCache: {
            getTemp: sinon.stub().resolves('/tmp/test'),
          },
        },
        '../../../utils/command': {
          ExecuteCMD: executeCMDStub,
        },
        'fs/promises': {
          stat: statStub,
          rm: sinon.stub().resolves(),
          mkdir: sinon.stub().resolves(),
          readFile: readFileStub,
        },
      });

      const command = generateModule.default();
      await command.parseAsync(['node', 'test', '--module', '/test/module']);

      expect(spinnerFailStub).to.have.been.called;
    });

    it('should handle tsconfig with undefined compilerOptions', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exportsPath: './exports',
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);

      // Simulate stat returning false (directory doesn't exist)
      const statStub = sinon.stub();
      statStub.callsFake(() => Promise.reject({ code: 'ENOENT' }));

      const executeCMDStub = sinon.stub().resolves({ code: 0, stderr: '' });

      // Return tsconfig without compilerOptions (undefined)
      const readFileStub = sinon.stub().resolves(JSON.stringify({}));

      const generateModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/generate', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          info: infoStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../../../common/cache': {
          ModuleCache: {
            getTemp: sinon.stub().resolves('/tmp/test'),
          },
        },
        '../../../utils/command': {
          ExecuteCMD: executeCMDStub,
        },
        'fs/promises': {
          stat: statStub,
          rm: sinon.stub().resolves(),
          mkdir: sinon.stub().resolves(),
          readFile: readFileStub,
        },
      });

      const command = generateModule.default();
      await command.parseAsync(['node', 'test', '--module', '/test/module']);

      // Without outDir, should fail
      expect(spinnerFailStub).to.have.been.called;
    });

    it('should handle interface folder not existing', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exportsPath: './dist/exports',
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);

      // First stat call for clean output - not existing, second for interface folder - not existing
      const statStub = sinon.stub();
      statStub.callsFake(() => Promise.reject({ code: 'ENOENT' }));

      const executeCMDStub = sinon.stub().resolves({ code: 0, stderr: '' });

      const generateModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/generate', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          info: infoStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../../../common/cache': {
          ModuleCache: {
            getTemp: sinon.stub().resolves('/tmp/test'),
          },
        },
        '../../../utils/command': {
          ExecuteCMD: executeCMDStub,
        },
        'fs/promises': {
          stat: statStub,
          rm: sinon.stub().resolves(),
          mkdir: sinon.stub().resolves(),
          readFile: sinon.stub().resolves(JSON.stringify({ compilerOptions: { outDir: './dist' } })),
        },
      });

      const command = generateModule.default();
      await command.parseAsync(['node', 'test', '--module', '/test/module']);

      // Interface folder doesn't exist, should fail
      expect(spinnerFailStub).to.have.been.called;
      expect(process.exitCode).to.equal(1);
    });

    it('should successfully generate exports', async () => {
      const manifest = {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
          exportsPath: './dist/exports',
        },
      };
      const readModuleManifestStub = sinon.stub().resolves(manifest);

      // All stat calls succeed where needed
      const statStub = sinon.stub();
      statStub.callsFake(() => Promise.resolve({ isDirectory: () => true }));

      // All executeCMD calls succeed
      const executeCMDStub = sinon.stub().resolves({ code: 0, stderr: '' });

      const generateModule = proxyquire.noCallThru()('../../../../../src/cli/module/exports/generate', {
        '../../common': {
          readModuleManifest: readModuleManifestStub,
          Options: Options,
        },
        '../../../utils/cli-ui': {
          displayBox: displayBoxStub,
          error: errorStub,
          warning: warningStub,
          info: infoStub,
          Spinner: function () {
            return createMockSpinner();
          },
        },
        '../../../common/cache': {
          ModuleCache: {
            getTemp: sinon.stub().resolves('/tmp/test'),
          },
        },
        '../../../utils/command': {
          ExecuteCMD: executeCMDStub,
        },
        'fs/promises': {
          stat: statStub,
          rm: sinon.stub().resolves(),
          mkdir: sinon.stub().resolves(),
          readFile: sinon.stub().resolves(JSON.stringify({ compilerOptions: { outDir: './dist' } })),
        },
      });

      const command = generateModule.default();
      await command.parseAsync(['node', 'test', '--module', '/test/module']);

      expect(spinnerSucceedStub).to.have.been.called;
      expect(displayBoxStub).to.have.been.called;
    });
  });
});
