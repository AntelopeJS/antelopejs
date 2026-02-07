import { expect } from 'chai';
import EventEmitter from 'events';
import sinon from 'sinon';
import { ConfigLoader } from '../../../src/core/config/config-loader';
import { Logging } from '../../../src/interfaces/logging/beta';
import * as logging from '../../../src/logging';

type ProcessEventName = 'uncaughtException' | 'unhandledRejection' | 'warning';

type ProcessListenerSnapshot = Record<ProcessEventName, Function[]>;

function snapshotProcessListeners(): ProcessListenerSnapshot {
  return {
    uncaughtException: process.listeners('uncaughtException'),
    unhandledRejection: process.listeners('unhandledRejection'),
    warning: process.listeners('warning'),
  };
}

function restoreProcessListeners(snapshot: ProcessListenerSnapshot): void {
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  process.removeAllListeners('warning');

  snapshot.uncaughtException.forEach((listener) => process.on('uncaughtException', listener as any));
  snapshot.unhandledRejection.forEach((listener) => process.on('unhandledRejection', listener as any));
  snapshot.warning.forEach((listener) => process.on('warning', listener as any));
}

function loadBootstrapModule() {
  const modulePath = require.resolve('../../../src/core/runtime/runtime-bootstrap');
  delete require.cache[modulePath];
  return require(modulePath) as typeof import('../../../src/core/runtime/runtime-bootstrap');
}

describe('runtime runtime-bootstrap', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('registers process handlers once and handles all branches', () => {
    const originalListeners = snapshotProcessListeners();
    const bootstrap = loadBootstrapModule();

    const exitStub = sinon.stub(process, 'exit');
    const errorStub = sinon.stub(Logging, 'Error');
    const warnStub = sinon.stub(Logging, 'Warn');

    try {
      bootstrap.setupProcessHandlers();
      bootstrap.setupProcessHandlers();

      const current = snapshotProcessListeners();
      expect(current.uncaughtException.length).to.equal(originalListeners.uncaughtException.length + 1);
      expect(current.unhandledRejection.length).to.equal(originalListeners.unhandledRejection.length + 1);
      expect(current.warning.length).to.equal(originalListeners.warning.length + 1);

      const uncaught = current.uncaughtException[current.uncaughtException.length - 1] as (error: Error) => void;
      uncaught({ message: 'boom-no-stack' } as Error);
      uncaught(new Error('boom-with-stack'));

      const rejection = current.unhandledRejection[current.unhandledRejection.length - 1] as (reason: unknown) => void;
      rejection(new AggregateError([new Error('inner-a'), 'inner-b'], 'agg'));
      rejection('plain rejection');

      const warningListener = current.warning[current.warning.length - 1] as (warning: Error) => void;
      warningListener(new Error('warned'));

      expect(errorStub.called).to.equal(true);
      expect(warnStub.calledWith('Warning:', 'warned')).to.equal(true);
      expect(exitStub.calledWith(1)).to.equal(true);
    } finally {
      restoreProcessListeners(originalListeners);
    }
  });

  it('raises and restores max listeners on success and failure', async () => {
    const bootstrap = loadBootstrapModule();
    const originalMax = EventEmitter.defaultMaxListeners;

    EventEmitter.defaultMaxListeners = 7;
    const result = await bootstrap.withRaisedMaxListeners(async () => {
      expect(EventEmitter.defaultMaxListeners).to.equal(50);
      return 'ok';
    });

    expect(result).to.equal('ok');
    expect(EventEmitter.defaultMaxListeners).to.equal(7);

    let thrown: unknown;
    try {
      await bootstrap.withRaisedMaxListeners(async () => {
        throw new Error('failure');
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect(EventEmitter.defaultMaxListeners).to.equal(7);

    EventEmitter.defaultMaxListeners = originalMax;
  });

  it('normalizes config and applies verbose channels when loading runtime config', async () => {
    const originalListeners = snapshotProcessListeners();
    const bootstrap = loadBootstrapModule();

    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      name: 'sample',
      cacheFolder: '.cache',
      modules: undefined,
      envOverrides: {},
      logging: { enabled: true },
    } as any);

    const setupLoggingStub = sinon.stub(logging, 'setupAntelopeProjectLogging');
    const addFilterStub = sinon.stub(logging, 'addChannelFilter');

    try {
      const loaded = await bootstrap.loadProjectRuntimeConfig('/project', 'prod', {
        verbose: ['runtime', 'loader'],
      });

      expect(loaded.normalizedConfig.cacheFolder).to.equal('/project/.cache');
      expect(loaded.normalizedConfig.modules).to.deep.equal({});
      expect(setupLoggingStub.calledOnce).to.equal(true);
      expect(addFilterStub.calledWith('runtime', 0)).to.equal(true);
      expect(addFilterStub.calledWith('loader', 0)).to.equal(true);

      await bootstrap.loadProjectRuntimeConfig('/project', 'prod', {});
      expect(addFilterStub.callCount).to.equal(2);
    } finally {
      restoreProcessListeners(originalListeners);
    }
  });

  it('normalizes absolute cache folders without modification', () => {
    const bootstrap = loadBootstrapModule();

    const normalized = bootstrap.normalizeLoadedConfig(
      {
        name: 'sample',
        cacheFolder: '/var/cache',
        modules: undefined,
        envOverrides: {},
      } as any,
      '/project',
    );

    expect(normalized.cacheFolder).to.equal('/var/cache');
    expect(normalized.projectFolder).to.equal('/project');
  });
});
