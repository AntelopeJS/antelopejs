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

    registry.remove('mod');
    expect(registry.list()).to.deep.equal([]);
  });
});
