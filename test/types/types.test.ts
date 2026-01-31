import { expect } from 'chai';
import { ModuleState } from '../../src/types';

describe('Types', () => {
  describe('ModuleState', () => {
    it('should have correct enum values', () => {
      expect(ModuleState.Loaded).to.equal('loaded');
      expect(ModuleState.Constructed).to.equal('constructed');
      expect(ModuleState.Active).to.equal('active');
    });
  });
});
