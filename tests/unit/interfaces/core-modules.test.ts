import { expect } from '../../helpers/setup';

describe('interfaces/core/beta/modules', () => {
  describe('module interface exports', () => {
    it('should export the module successfully', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      // Types don't exist at runtime, but the module should load
      expect(modules).to.exist;
    });

    it('should export Events namespace', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      expect(modules.Events).to.exist;
    });

    it('should export Events.ModuleConstructed', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      expect(modules.Events.ModuleConstructed).to.exist;
    });

    it('should export Events.ModuleStarted', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      expect(modules.Events.ModuleStarted).to.exist;
    });

    it('should export Events.ModuleStopped', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      expect(modules.Events.ModuleStopped).to.exist;
    });

    it('should export Events.ModuleDestroyed', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      expect(modules.Events.ModuleDestroyed).to.exist;
    });

    it('should export ListModules function', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      expect(modules.ListModules).to.exist;
    });

    it('should export GetModuleInfo function', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      expect(modules.GetModuleInfo).to.exist;
    });

    it('should export LoadModule function', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      expect(modules.LoadModule).to.exist;
    });

    it('should export StartModule function', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      expect(modules.StartModule).to.exist;
    });

    it('should export StopModule function', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      expect(modules.StopModule).to.exist;
    });

    it('should export DestroyModule function', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      expect(modules.DestroyModule).to.exist;
    });

    it('should export ReloadModule function', () => {
      const modules = require('../../../src/interfaces/core/beta/modules');
      expect(modules.ReloadModule).to.exist;
    });
  });

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
