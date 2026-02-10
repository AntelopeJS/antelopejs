import { expect } from 'chai';
import sinon from 'sinon';
import { ModuleLifecycle } from '../../src/core/module-lifecycle';
import { ModuleState } from '../../src/types';

describe('ModuleLifecycle', () => {
  it('should transition through lifecycle states', async () => {
    const calls: string[] = [];
    const lifecycle = new ModuleLifecycle('mod');

    lifecycle.setCallbacks({
      construct: () => {
        calls.push('construct');
      },
      start: () => {
        calls.push('start');
      },
      stop: () => {
        calls.push('stop');
      },
      destroy: () => {
        calls.push('destroy');
      },
    });

    expect(lifecycle.state).to.equal(ModuleState.Loaded);

    await lifecycle.construct({});
    expect(lifecycle.state).to.equal(ModuleState.Constructed);

    lifecycle.start();
    expect(lifecycle.state).to.equal(ModuleState.Active);

    await lifecycle.stop();
    expect(lifecycle.state).to.equal(ModuleState.Constructed);

    await lifecycle.destroy();
    expect(lifecycle.state).to.equal(ModuleState.Loaded);

    expect(calls).to.deep.equal(['construct', 'start', 'stop', 'destroy']);
  });

  it('should ignore start/stop when in the wrong state', async () => {
    const callbacks = {
      start: sinon.spy(),
      stop: sinon.spy(),
    };
    const lifecycle = new ModuleLifecycle('mod');
    lifecycle.setCallbacks(callbacks);

    lifecycle.start();
    await lifecycle.stop();

    expect(callbacks.start.called).to.equal(false);
    expect(callbacks.stop.called).to.equal(false);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it('should not construct twice', async () => {
    const callbacks = { construct: sinon.spy() };
    const lifecycle = new ModuleLifecycle('mod');
    lifecycle.setCallbacks(callbacks);

    await lifecycle.construct({});
    await lifecycle.construct({});

    expect(callbacks.construct.calledOnce).to.equal(true);
    expect(lifecycle.state).to.equal(ModuleState.Constructed);
  });

  it('should stop active modules during destroy', async () => {
    const callbacks = {
      stop: sinon.spy(),
      destroy: sinon.spy(),
    };
    const lifecycle = new ModuleLifecycle('mod');
    lifecycle.setCallbacks(callbacks);

    await lifecycle.construct({});
    lifecycle.start();
    await lifecycle.destroy();

    expect(callbacks.stop.calledOnce).to.equal(true);
    expect(callbacks.destroy.calledOnce).to.equal(true);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it('should do nothing on destroy when already loaded', async () => {
    const callbacks = { destroy: sinon.spy() };
    const lifecycle = new ModuleLifecycle('mod');
    lifecycle.setCallbacks(callbacks);

    await lifecycle.destroy();

    expect(callbacks.destroy.called).to.equal(false);
    expect(lifecycle.state).to.equal(ModuleState.Loaded);
  });

  it('should await async stop callback', async () => {
    const calls: string[] = [];
    const lifecycle = new ModuleLifecycle('mod');

    lifecycle.setCallbacks({
      construct: () => {
        calls.push('construct');
      },
      start: () => {
        calls.push('start');
      },
      stop: async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        calls.push('stop');
      },
      destroy: () => {
        calls.push('destroy');
      },
    });

    await lifecycle.construct({});
    lifecycle.start();
    await lifecycle.stop();
    await lifecycle.destroy();

    expect(calls).to.deep.equal(['construct', 'start', 'stop', 'destroy']);
  });
});
