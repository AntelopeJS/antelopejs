import { expect, sinon } from '../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import proxyquire from 'proxyquire';
import EventEmitter from 'events';

describe('src/index (startAntelope)', () => {
  const testDir = path.join(__dirname, '../fixtures/test-index-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    sinon.restore();
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('module exports', () => {
    it('should export a default function', () => {
      const startAntelope = require('../../src/index').default;
      expect(startAntelope).to.be.a('function');
    });

    it('should export TestModule function', () => {
      const { TestModule } = require('../../src/index');
      expect(TestModule).to.be.a('function');
    });
  });

  describe('error handling', () => {
    it('should throw when project path does not exist', async () => {
      const { LoadConfig } = require('../../src/common/config');

      try {
        await LoadConfig('/nonexistent/path', 'default');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).to.exist;
      }
    });

    it('should throw when antelope.json is missing', async () => {
      const { LoadConfig } = require('../../src/common/config');

      // Create an empty directory
      const emptyDir = path.join(testDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });

      try {
        await LoadConfig(emptyDir, 'default');
        expect.fail('Should have thrown');
      } catch (err: any) {
        // Should throw about missing config
        expect(err).to.exist;
      }
    });

    it('should throw when antelope.json is invalid JSON', async () => {
      const { LoadConfig } = require('../../src/common/config');

      // Create a directory with invalid antelope.json
      const invalidDir = path.join(testDir, 'invalid');
      fs.mkdirSync(invalidDir, { recursive: true });
      fs.writeFileSync(path.join(invalidDir, 'antelope.json'), 'not valid json{{{');

      try {
        await LoadConfig(invalidDir, 'default');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });
});

describe('src/index with mocks', () => {
  let indexModule: any;
  let mockModuleManager: any;
  let MockModuleManagerClass: sinon.SinonStub;
  let mockConfig: any;
  let mockLogging: any;
  let mockExitHook: sinon.SinonStub;
  let mockLoggingInterface: any;
  let mockRepl: any;
  let mockReplInstance: any;

  beforeEach(() => {
    mockModuleManager = {
      init: sinon.stub().resolves(),
      startModules: sinon.stub(),
      shutdown: sinon.stub().resolves(),
      startWatcher: sinon.stub().resolves(),
    };

    MockModuleManagerClass = sinon.stub().returns(mockModuleManager);

    mockConfig = {
      LoadConfig: sinon.stub().resolves({
        modules: {},
        logging: { enabled: true },
        cacheFolder: '.cache',
      }),
    };

    mockLogging = {
      setupAntelopeProjectLogging: sinon.stub(),
      addChannelFilter: sinon.stub(),
    };

    mockLoggingInterface = {
      Logging: {
        Error: sinon.stub(),
        Warn: sinon.stub(),
        Debug: sinon.stub(),
      },
    };

    mockExitHook = sinon.stub();

    mockReplInstance = new EventEmitter();
    mockReplInstance.context = {};
    mockReplInstance.setupHistory = sinon.stub();

    mockRepl = {
      start: sinon.stub().returns(mockReplInstance),
    };

    indexModule = proxyquire('../../src/index', {
      './loader': { ModuleManager: MockModuleManagerClass },
      './common/config': mockConfig,
      './logging': mockLogging,
      'async-exit-hook': mockExitHook,
      './interfaces/logging/beta': mockLoggingInterface,
      repl: mockRepl,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('default export (launch)', () => {
    it('should load config from project folder with default env', async () => {
      await indexModule.default('/path/to/project');

      expect(mockConfig.LoadConfig.calledOnce).to.be.true;
      expect(mockConfig.LoadConfig.firstCall.args[0]).to.equal('/path/to/project');
      expect(mockConfig.LoadConfig.firstCall.args[1]).to.equal('default');
    });

    it('should load config from project folder with custom env', async () => {
      await indexModule.default('/path/to/project', 'production');

      expect(mockConfig.LoadConfig.calledOnce).to.be.true;
      expect(mockConfig.LoadConfig.firstCall.args[1]).to.equal('production');
    });

    it('should setup logging with config', async () => {
      await indexModule.default('/path/to/project');

      expect(mockLogging.setupAntelopeProjectLogging.calledOnce).to.be.true;
      expect(mockLogging.setupAntelopeProjectLogging.firstCall.args[0]).to.deep.equal({ enabled: true });
    });

    it('should add verbose channel filters when verbose option provided', async () => {
      await indexModule.default('/path/to/project', 'default', { verbose: ['loader', 'module'] });

      expect(mockLogging.addChannelFilter.calledTwice).to.be.true;
      expect(mockLogging.addChannelFilter.firstCall.args).to.deep.equal(['loader', 0]);
      expect(mockLogging.addChannelFilter.secondCall.args).to.deep.equal(['module', 0]);
    });

    it('should create ModuleManager with correct arguments', async () => {
      await indexModule.default('/path/to/project', 'default', { concurrency: 20 });

      expect(MockModuleManagerClass.calledOnce).to.be.true;
      const args = MockModuleManagerClass.firstCall.args;
      expect(args[3]).to.equal(20); // concurrency
    });

    it('should initialize module manager', async () => {
      await indexModule.default('/path/to/project');

      expect(mockModuleManager.init.calledOnce).to.be.true;
    });

    it('should start modules after initialization', async () => {
      await indexModule.default('/path/to/project');

      expect(mockModuleManager.startModules.calledOnce).to.be.true;
    });

    it('should start watcher when watch option is true', async () => {
      await indexModule.default('/path/to/project', 'default', { watch: true });

      expect(mockModuleManager.startWatcher.calledOnce).to.be.true;
    });

    it('should not start watcher when watch option is false', async () => {
      await indexModule.default('/path/to/project', 'default', { watch: false });

      expect(mockModuleManager.startWatcher.called).to.be.false;
    });

    it('should handle watcher errors gracefully', async () => {
      mockModuleManager.startWatcher.rejects(new Error('Watcher error'));

      await indexModule.default('/path/to/project', 'default', { watch: true });

      expect(mockLoggingInterface.Logging.Error.calledOnce).to.be.true;
    });

    it('should setup exit hook', async () => {
      await indexModule.default('/path/to/project');

      expect(mockExitHook.calledOnce).to.be.true;
    });

    it('should call shutdown on exit', async () => {
      await indexModule.default('/path/to/project');

      // Get the callback passed to exitHook
      const exitCallback = mockExitHook.firstCall.args[0];

      // Call the exit callback
      const doneCallback = sinon.stub();
      await exitCallback(doneCallback);

      expect(mockModuleManager.shutdown.calledOnce).to.be.true;
      expect(doneCallback.calledOnce).to.be.true;
    });

    it('should handle shutdown errors in exit hook', async () => {
      mockModuleManager.shutdown.rejects(new Error('Shutdown error'));

      await indexModule.default('/path/to/project');

      // Get the callback passed to exitHook
      const exitCallback = mockExitHook.firstCall.args[0];

      // Call the exit callback
      const doneCallback = sinon.stub();
      await exitCallback(doneCallback);

      expect(mockLoggingInterface.Logging.Error.calledOnce).to.be.true;
      expect(doneCallback.calledOnce).to.be.true; // Should still call done
    });

    it('should start REPL when interactive option is true', async () => {
      await indexModule.default('/path/to/project', 'default', { interactive: true });

      expect(mockRepl.start.calledOnce).to.be.true;
      expect(mockRepl.start.firstCall.args[0]).to.equal('> ');
      expect(mockReplInstance.context.moduleManager).to.equal(mockModuleManager);
      expect(mockReplInstance.setupHistory.calledOnce).to.be.true;
    });

    it('should shutdown and exit when REPL is closed', async () => {
      const exitStub = sinon.stub(process, 'exit');

      await indexModule.default('/path/to/project', 'default', { interactive: true });

      // Emit close event on the REPL instance
      mockReplInstance.emit('close');

      // Wait for the async handler
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockModuleManager.shutdown.calledOnce).to.be.true;
      expect(exitStub.calledWith(0)).to.be.true;
    });

    it('should not start REPL when interactive option is false', async () => {
      await indexModule.default('/path/to/project', 'default', { interactive: false });

      expect(mockRepl.start.called).to.be.false;
    });

    it('should handle init error and exit with code 1', async () => {
      const exitStub = sinon.stub(process, 'exit');
      mockModuleManager.init.rejects(new Error('Init error'));

      await indexModule.default('/path/to/project');

      expect(mockLoggingInterface.Logging.Error.called).to.be.true;
      expect(exitStub.calledWith(1)).to.be.true;
    });

    it('should use default values for projectFolder and env', async () => {
      await indexModule.default();

      expect(mockConfig.LoadConfig.firstCall.args[0]).to.equal('.');
      expect(mockConfig.LoadConfig.firstCall.args[1]).to.equal('default');
    });
  });
});

describe('ConvertConfig', () => {
  let indexModule: any;
  let MockModuleManagerClass: sinon.SinonStub;

  beforeEach(() => {
    MockModuleManagerClass = sinon.stub().returns({
      init: sinon.stub().resolves(),
      startModules: sinon.stub(),
      shutdown: sinon.stub().resolves(),
      startWatcher: sinon.stub().resolves(),
    });

    indexModule = proxyquire('../../src/index', {
      './loader': { ModuleManager: MockModuleManagerClass },
      './common/config': {
        LoadConfig: sinon.stub().resolves({
          modules: {
            'test-module': {
              source: { type: 'local', path: '/path/to/module' },
              config: { key: 'value' },
              importOverrides: [{ interface: 'core/beta', source: 'other-module', id: 'custom-id' }],
              disabledExports: ['export1'],
            },
            'simple-module': {
              source: { type: 'package', package: 'simple', version: '1.0.0' },
              config: {},
              importOverrides: [],
              disabledExports: [],
            },
          },
          logging: {},
          cacheFolder: '.cache',
        }),
      },
      './logging': {
        setupAntelopeProjectLogging: sinon.stub(),
        addChannelFilter: sinon.stub(),
      },
      'async-exit-hook': sinon.stub(),
      './interfaces/logging/beta': { Logging: { Error: sinon.stub(), Warn: sinon.stub() } },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should convert config modules to legacy format with sources', async () => {
    await indexModule.default('/path/to/project');

    const initArgs = MockModuleManagerClass.returnValues[0].init.firstCall.args[0];

    expect(initArgs.sources).to.be.an('array');
    expect(initArgs.sources.length).to.equal(2);

    const testModule = initArgs.sources.find((s: any) => s.id === 'test-module');
    expect(testModule).to.exist;
    expect(testModule.type).to.equal('local');
    expect(testModule.path).to.equal('/path/to/module');
  });

  it('should convert importOverrides to Map format', async () => {
    await indexModule.default('/path/to/project');

    const initArgs = MockModuleManagerClass.returnValues[0].init.firstCall.args[0];

    expect(initArgs.configs['test-module'].importOverrides).to.be.instanceOf(Map);
    expect(initArgs.configs['test-module'].importOverrides.get('core/beta')).to.deep.equal([
      { module: 'other-module', id: 'custom-id' },
    ]);
  });

  it('should convert disabledExports to Set format', async () => {
    await indexModule.default('/path/to/project');

    const initArgs = MockModuleManagerClass.returnValues[0].init.firstCall.args[0];

    expect(initArgs.configs['test-module'].disabledExports).to.be.instanceOf(Set);
    expect(initArgs.configs['test-module'].disabledExports.has('export1')).to.be.true;
  });

  it('should preserve module config', async () => {
    await indexModule.default('/path/to/project');

    const initArgs = MockModuleManagerClass.returnValues[0].init.firstCall.args[0];

    expect(initArgs.configs['test-module'].config).to.deep.equal({ key: 'value' });
  });

  it('should handle modules with multiple importOverrides for same interface', async () => {
    const mockModuleManager = {
      init: sinon.stub().resolves(),
      startModules: sinon.stub(),
      shutdown: sinon.stub().resolves(),
      startWatcher: sinon.stub().resolves(),
    };

    const MockManager = sinon.stub().returns(mockModuleManager);

    const moduleWithMultipleOverrides = proxyquire('../../src/index', {
      './loader': { ModuleManager: MockManager },
      './common/config': {
        LoadConfig: sinon.stub().resolves({
          modules: {
            'test-module': {
              source: { type: 'local', path: '/path/to/module' },
              config: {},
              importOverrides: [
                { interface: 'core/beta', source: 'module-a' },
                { interface: 'core/beta', source: 'module-b', id: 'second' },
              ],
              disabledExports: [],
            },
          },
          logging: {},
          cacheFolder: '.cache',
        }),
      },
      './logging': {
        setupAntelopeProjectLogging: sinon.stub(),
        addChannelFilter: sinon.stub(),
      },
      'async-exit-hook': sinon.stub(),
      './interfaces/logging/beta': { Logging: { Error: sinon.stub(), Warn: sinon.stub() } },
    });

    await moduleWithMultipleOverrides.default('/path/to/project');

    const initArgs = mockModuleManager.init.firstCall.args[0];
    const overrides = initArgs.configs['test-module'].importOverrides.get('core/beta');

    expect(overrides).to.have.length(2);
    expect(overrides[0]).to.deep.equal({ module: 'module-a', id: undefined });
    expect(overrides[1]).to.deep.equal({ module: 'module-b', id: 'second' });
  });
});

describe('setupProcessHandlers', () => {
  let indexModule: any;
  let processOnStub: sinon.SinonStub;
  let processExitStub: sinon.SinonStub;
  let mockLoggingInterface: any;

  beforeEach(() => {
    processOnStub = sinon.stub(process, 'on');
    processExitStub = sinon.stub(process, 'exit');

    mockLoggingInterface = {
      Logging: {
        Error: sinon.stub(),
        Warn: sinon.stub(),
      },
    };

    indexModule = proxyquire('../../src/index', {
      './loader': {
        ModuleManager: sinon.stub().returns({
          init: sinon.stub().resolves(),
          startModules: sinon.stub(),
          shutdown: sinon.stub().resolves(),
          startWatcher: sinon.stub().resolves(),
        }),
      },
      './common/config': {
        LoadConfig: sinon.stub().resolves({
          modules: {},
          logging: {},
          cacheFolder: '.cache',
        }),
      },
      './logging': {
        setupAntelopeProjectLogging: sinon.stub(),
        addChannelFilter: sinon.stub(),
      },
      'async-exit-hook': sinon.stub(),
      './interfaces/logging/beta': mockLoggingInterface,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should register uncaughtException handler', async () => {
    await indexModule.default('/path/to/project');

    const uncaughtCall = processOnStub.getCalls().find((c) => c.args[0] === 'uncaughtException');
    expect(uncaughtCall).to.exist;

    // Test the handler
    const handler = uncaughtCall!.args[1];
    handler(new Error('Test uncaught error'));

    expect(mockLoggingInterface.Logging.Error.calledWith('Test uncaught error')).to.be.true;
    expect(processExitStub.calledWith(1)).to.be.true;
  });

  it('should register unhandledRejection handler', async () => {
    await indexModule.default('/path/to/project');

    const unhandledCall = processOnStub.getCalls().find((c) => c.args[0] === 'unhandledRejection');
    expect(unhandledCall).to.exist;

    // Test the handler with a simple error
    const handler = unhandledCall!.args[1];
    handler('Test rejection reason');

    expect(mockLoggingInterface.Logging.Error.calledWith('Test rejection reason')).to.be.true;
    expect(processExitStub.calledWith(1)).to.be.true;
  });

  it('should handle AggregateError in unhandledRejection', async () => {
    await indexModule.default('/path/to/project');

    const unhandledCall = processOnStub.getCalls().find((c) => c.args[0] === 'unhandledRejection');
    const handler = unhandledCall!.args[1];

    const aggregateError = new AggregateError([new Error('Error 1'), new Error('Error 2')], 'Multiple errors');
    handler(aggregateError);

    // Should log the main error and each sub-error
    expect(mockLoggingInterface.Logging.Error.callCount).to.be.at.least(3);
  });

  it('should register warning handler', async () => {
    await indexModule.default('/path/to/project');

    const warningCall = processOnStub.getCalls().find((c) => c.args[0] === 'warning');
    expect(warningCall).to.exist;

    // Test the handler
    const handler = warningCall!.args[1];
    handler(new Error('Test warning'));

    expect(mockLoggingInterface.Logging.Warn.calledWith('Test warning')).to.be.true;
  });
});

describe('TestModule', () => {
  it('should export TestModule function', () => {
    const { TestModule } = require('../../src/index');
    expect(TestModule).to.be.a('function');
  });

  it('should return early when package.json is missing antelopeJs.test config', async function () {
    this.timeout(10000);

    // Create a temporary module folder with a valid package.json but no test config
    const tempModuleDir = path.join(__dirname, '../fixtures/test-module-' + Date.now());
    fs.mkdirSync(tempModuleDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempModuleDir, 'package.json'),
      JSON.stringify({ name: 'test-module', version: '1.0.0' }),
    );

    const consoleErrorStub = sinon.stub(console, 'error');

    try {
      const { TestModule } = require('../../src/index');
      await TestModule(tempModuleDir);

      expect(consoleErrorStub.calledWith('Missing AntelopeJS test config')).to.be.true;
    } finally {
      consoleErrorStub.restore();
      fs.rmSync(tempModuleDir, { recursive: true, force: true });
    }
  });
});

describe('LaunchOptions interface', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should accept all valid options', async () => {
    const mockModuleManager = {
      init: sinon.stub().resolves(),
      startModules: sinon.stub(),
      shutdown: sinon.stub().resolves(),
      startWatcher: sinon.stub().resolves(),
    };

    const MockModuleManagerClass = sinon.stub().returns(mockModuleManager);

    const indexModule = proxyquire('../../src/index', {
      './loader': { ModuleManager: MockModuleManagerClass },
      './common/config': {
        LoadConfig: sinon.stub().resolves({
          modules: {},
          logging: {},
          cacheFolder: '.cache',
        }),
      },
      './logging': {
        setupAntelopeProjectLogging: sinon.stub(),
        addChannelFilter: sinon.stub(),
      },
      'async-exit-hook': sinon.stub(),
      './interfaces/logging/beta': { Logging: { Error: sinon.stub(), Warn: sinon.stub() } },
    });

    // Test with all options
    await indexModule.default('/path/to/project', 'default', {
      watch: true,
      concurrency: 10,
      interactive: false,
      verbose: ['loader'],
    });

    // Should not throw and should handle all options
    expect(mockModuleManager.init.calledOnce).to.be.true;
    expect(mockModuleManager.startWatcher.calledOnce).to.be.true;
  });

  it('should work with empty options object', async () => {
    const mockModuleManager = {
      init: sinon.stub().resolves(),
      startModules: sinon.stub(),
      shutdown: sinon.stub().resolves(),
      startWatcher: sinon.stub().resolves(),
    };

    const MockModuleManagerClass = sinon.stub().returns(mockModuleManager);

    const indexModule = proxyquire('../../src/index', {
      './loader': { ModuleManager: MockModuleManagerClass },
      './common/config': {
        LoadConfig: sinon.stub().resolves({
          modules: {},
          logging: {},
          cacheFolder: '.cache',
        }),
      },
      './logging': {
        setupAntelopeProjectLogging: sinon.stub(),
        addChannelFilter: sinon.stub(),
      },
      'async-exit-hook': sinon.stub(),
      './interfaces/logging/beta': { Logging: { Error: sinon.stub(), Warn: sinon.stub() } },
    });

    await indexModule.default('/path/to/project', 'default', {});

    expect(mockModuleManager.init.calledOnce).to.be.true;
    expect(mockModuleManager.startWatcher.called).to.be.false;
  });
});
