import { expect } from 'chai';
import { ProxyTracker } from '../../src/core/proxy-tracker';
import { AsyncProxy, RegisteringProxy, internal } from '../../src/interfaces/core/beta';

describe('ProxyTracker', () => {
  beforeEach(() => {
    internal.knownAsync.clear();
    internal.knownRegisters.clear();
  });

  it('should track async and registering proxies', () => {
    const tracker = new ProxyTracker();
    const asyncProxy = new AsyncProxy();
    const registerProxy = new RegisteringProxy();

    tracker.addAsyncProxy('modA', asyncProxy);
    tracker.addRegisteringProxy('modA', registerProxy);

    expect(internal.knownAsync.get('modA')).to.deep.equal([asyncProxy]);
    expect(internal.knownRegisters.get('modA')).to.deep.equal([registerProxy]);
  });

  it('should clear proxies for a module', () => {
    const tracker = new ProxyTracker();
    const asyncProxy = new AsyncProxy();

    tracker.addAsyncProxy('modA', asyncProxy);
    tracker.clearModule('modA');

    expect(internal.knownAsync.has('modA')).to.be.false;
  });
});
