import { expect } from 'chai';
import { InterfaceRegistry } from '../../src/core/interface-registry';
import { internal } from '../../src/interfaces/core/beta';

describe('InterfaceRegistry', () => {
  beforeEach(() => {
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it('should map interface connections for a module', () => {
    const registry = new InterfaceRegistry();

    const connections = new Map<string, Array<{ module: string; id?: string }>>();
    connections.set('core@beta', [
      { module: 'modA' },
      { module: 'modB', id: 'x' },
    ]);

    registry.setConnections('consumer', connections);

    expect(internal.interfaceConnections.consumer['core@beta']).to.deep.equal([
      { path: '@ajs.raw/modA/core@beta' },
      { path: '@ajs.raw/modB/core@beta', id: 'x' },
    ]);
  });

  it('should clear connections for a module', () => {
    const registry = new InterfaceRegistry();
    const connections = new Map<string, Array<{ module: string }>>();
    connections.set('core@beta', [{ module: 'modA' }]);
    registry.setConnections('consumer', connections);

    registry.clearModule('consumer');

    expect(internal.interfaceConnections.consumer).to.be.undefined;
  });

  it('should return empty list when no connections are set', () => {
    const registry = new InterfaceRegistry();

    expect(registry.getConnections('missing', 'core@beta')).to.deep.equal([]);
  });

  it('should return empty list when interface is missing', () => {
    const registry = new InterfaceRegistry();
    const connections = new Map<string, Array<{ module: string }>>();
    connections.set('core@beta', [{ module: 'modA' }]);
    registry.setConnections('consumer', connections);

    expect(registry.getConnections('consumer', 'missing@beta')).to.deep.equal([]);
  });
});
