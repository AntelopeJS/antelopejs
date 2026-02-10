import { expect } from 'chai';
import sinon from 'sinon';
import { ShutdownManager } from '../../../src/core/shutdown/shutdown-manager';

const WAIT_FOR_SIGNAL_MS = 10;
const CUSTOM_TIMEOUT_MS = 500;

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, WAIT_FOR_SIGNAL_MS);
  });
}

describe('ShutdownManager', () => {
  let manager: ShutdownManager;

  beforeEach(() => {
    manager = new ShutdownManager();
  });

  afterEach(() => {
    manager.removeSignalHandlers();
    sinon.restore();
  });

  describe('handler registration and execution', () => {
    it('should execute registered handlers on shutdown', async () => {
      const handler = sinon.stub().resolves();
      manager.register(handler, 0);

      await manager.shutdown();

      expect(handler.calledOnce).to.equal(true);
    });

    it('should execute handlers in descending priority order', async () => {
      const calls: number[] = [];
      manager.register(async () => {
        calls.push(1);
      }, 1);
      manager.register(async () => {
        calls.push(3);
      }, 3);
      manager.register(async () => {
        calls.push(2);
      }, 2);

      await manager.shutdown();

      expect(calls).to.deep.equal([3, 2, 1]);
    });

    it('should not execute unregistered handlers', async () => {
      const handler = sinon.stub().resolves();
      manager.register(handler, 0);
      manager.unregister(handler);

      await manager.shutdown();

      expect(handler.called).to.equal(false);
    });

    it('should continue executing remaining handlers when one fails', async () => {
      const calls: number[] = [];
      manager.register(async () => {
        calls.push(1);
      }, 1);
      manager.register(async () => {
        throw new Error('fail');
      }, 2);
      manager.register(async () => {
        calls.push(3);
      }, 3);

      await manager.shutdown();

      expect(calls).to.deep.equal([3, 1]);
    });

    it('should only execute shutdown once', async () => {
      const handler = sinon.stub().resolves();
      manager.register(handler, 0);

      await Promise.all([manager.shutdown(), manager.shutdown()]);

      expect(handler.calledOnce).to.equal(true);
    });
  });

  describe('timeout', () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
      clock = sinon.useFakeTimers();
    });

    afterEach(() => {
      clock.restore();
    });

    it('should force resolve after timeout when handler hangs', async () => {
      manager = new ShutdownManager(CUSTOM_TIMEOUT_MS);
      const neverResolves = () => new Promise<void>(() => {});
      manager.register(neverResolves, 0);

      const shutdownPromise = manager.shutdown();
      clock.tick(CUSTOM_TIMEOUT_MS);

      await shutdownPromise;
    });
  });

  describe('signal handling', () => {
    it('should setup and remove signal listeners', () => {
      const initialSigintCount = process.listenerCount('SIGINT');
      const initialSigtermCount = process.listenerCount('SIGTERM');

      manager.setupSignalHandlers();

      expect(process.listenerCount('SIGINT')).to.equal(initialSigintCount + 1);
      expect(process.listenerCount('SIGTERM')).to.equal(initialSigtermCount + 1);

      manager.removeSignalHandlers();

      expect(process.listenerCount('SIGINT')).to.equal(initialSigintCount);
      expect(process.listenerCount('SIGTERM')).to.equal(initialSigtermCount);
    });

    it('should trigger shutdown on SIGINT', async () => {
      const handler = sinon.stub().resolves();
      const exitStub = sinon.stub(process, 'exit');
      manager.register(handler, 0);
      manager.setupSignalHandlers();

      process.emit('SIGINT');
      await waitForSignal();

      expect(handler.calledOnce).to.equal(true);
      expect(exitStub.calledWith(0)).to.equal(true);
    });

    it('should trigger shutdown on SIGTERM', async () => {
      const handler = sinon.stub().resolves();
      const exitStub = sinon.stub(process, 'exit');
      manager.register(handler, 0);
      manager.setupSignalHandlers();

      process.emit('SIGTERM');
      await waitForSignal();

      expect(handler.calledOnce).to.equal(true);
      expect(exitStub.calledWith(0)).to.equal(true);
    });

    it('should force exit on second signal during shutdown', async () => {
      const neverResolves = () => new Promise<void>(() => {});
      const exitStub = sinon.stub(process, 'exit');
      manager.register(neverResolves, 0);
      manager.setupSignalHandlers();

      process.emit('SIGINT');
      await waitForSignal();

      process.emit('SIGINT');

      expect(exitStub.calledWith(1)).to.equal(true);
    });
  });
});
