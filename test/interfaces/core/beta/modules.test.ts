import { expect } from 'chai';
import { AsyncProxy, RegisteringProxy, internal } from '../../../../src/interfaces/core/beta';
import { Events } from '../../../../src/interfaces/core/beta/modules';

describe('ModuleDestroyed cleanup', () => {
  beforeEach(() => {
    internal.knownAsync.clear();
    internal.knownRegisters.clear();
  });

  it('should remove module from knownAsync after destroy', () => {
    const proxy = new AsyncProxy();
    internal.addAsyncProxy('testModule', proxy);

    expect(internal.knownAsync.has('testModule')).to.equal(true);

    Events.ModuleDestroyed.emit('testModule');

    expect(internal.knownAsync.has('testModule')).to.equal(false);
  });

  it('should remove module from knownRegisters after destroy', () => {
    const proxy = new RegisteringProxy();
    internal.addRegisteringProxy('testModule', proxy);

    expect(internal.knownRegisters.has('testModule')).to.equal(true);

    Events.ModuleDestroyed.emit('testModule');

    expect(internal.knownRegisters.has('testModule')).to.equal(false);
  });
});
