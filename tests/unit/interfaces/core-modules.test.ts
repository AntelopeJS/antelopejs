import { expect } from '../../helpers/setup';

describe('interfaces/core/beta/modules', () => {
  describe('Events functionality', () => {
    it('should allow registering to ModuleConstructed event', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      const callback = () => {};

      // Should not throw
      expect(() => modules.Events.ModuleConstructed.register(callback)).to.not.throw();
    });

    it('should allow registering to ModuleStarted event', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      const callback = () => {};

      expect(() => modules.Events.ModuleStarted.register(callback)).to.not.throw();
    });

    it('should allow registering to ModuleStopped event', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      const callback = () => {};

      expect(() => modules.Events.ModuleStopped.register(callback)).to.not.throw();
    });

    it('should allow registering to ModuleDestroyed event', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      const callback = () => {};

      expect(() => modules.Events.ModuleDestroyed.register(callback)).to.not.throw();
    });
  });
});
