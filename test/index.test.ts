import { expect } from 'chai';
import launch, { ModuleManager } from '../src/index';

describe('Public API', () => {
  it('should export launch function and ModuleManager', () => {
    expect(launch).to.be.a('function');
    expect(ModuleManager).to.be.ok;
  });
});
