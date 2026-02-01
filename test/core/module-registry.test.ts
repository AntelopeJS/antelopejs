import { expect } from 'chai';
import { ModuleRegistry } from '../../src/core/module-registry';
import { Module } from '../../src/core/module';

const manifest = {
  name: 'mod',
  version: '1.0.0',
  main: '/mod/index.js',
} as any;

describe('ModuleRegistry', () => {
  it('should register and remove modules', () => {
    const registry = new ModuleRegistry();
    const mod = new Module(manifest, async () => ({}));

    registry.register(mod);

    expect(registry.list()).to.deep.equal(['mod']);
    expect(registry.get('mod')).to.equal(mod);
    expect(registry.has('mod')).to.equal(true);
    expect(registry.has('missing')).to.equal(false);

    const entries = Array.from(registry.entries());
    expect(entries.length).to.equal(1);
    expect(entries[0][0]).to.equal('mod');
    expect(entries[0][1]).to.equal(mod);

    registry.remove('mod');
    expect(registry.list()).to.deep.equal([]);
  });
});
