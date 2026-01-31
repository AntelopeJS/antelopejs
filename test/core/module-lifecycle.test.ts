import { expect } from 'chai';
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

    lifecycle.stop();
    expect(lifecycle.state).to.equal(ModuleState.Constructed);

    await lifecycle.destroy();
    expect(lifecycle.state).to.equal(ModuleState.Loaded);

    expect(calls).to.deep.equal(['construct', 'start', 'stop', 'destroy']);
  });
});
