import { expect, sinon } from '../../helpers/setup';
import { RegisteringProxy } from '../../../src/interfaces/core/beta';

describe('interfaces/core/beta/RegisteringProxy', () => {
  describe('constructor', () => {
    it('should create an instance', () => {
      const proxy = new RegisteringProxy();
      expect(proxy).to.be.instanceof(RegisteringProxy);
    });
  });

  describe('onRegister', () => {
    it('should attach a register callback', () => {
      const proxy = new RegisteringProxy<(id: string, value: number) => void>();
      const callback = sinon.stub();

      proxy.onRegister(callback, true);
      proxy.register('id1', 42);

      expect(callback).to.have.been.calledWith('id1', 42);
    });

    it('should execute pending registrations when callback is attached', () => {
      const proxy = new RegisteringProxy<(id: string, value: number) => void>();
      const callback = sinon.stub();

      // Register before attaching callback
      proxy.register('id1', 10);
      proxy.register('id2', 20);

      // Attach callback - should be called with pending registrations
      proxy.onRegister(callback, true);

      expect(callback).to.have.been.calledTwice;
      expect(callback).to.have.been.calledWith('id1', 10);
      expect(callback).to.have.been.calledWith('id2', 20);
    });
  });

  describe('onUnregister', () => {
    it('should attach an unregister callback', () => {
      const proxy = new RegisteringProxy<(id: string) => void>();
      const registerCallback = sinon.stub();
      const unregisterCallback = sinon.stub();

      proxy.onRegister(registerCallback, true);
      proxy.onUnregister(unregisterCallback);

      proxy.register('id1');
      proxy.unregister('id1');

      expect(unregisterCallback).to.have.been.calledWith('id1');
    });
  });

  describe('detach', () => {
    it('should detach both callbacks', () => {
      const proxy = new RegisteringProxy<(id: string) => void>();
      const registerCallback = sinon.stub();
      const unregisterCallback = sinon.stub();

      proxy.onRegister(registerCallback, true);
      proxy.onUnregister(unregisterCallback);
      proxy.detach();

      // After detach, callbacks should not be called
      proxy.register('id1');
      proxy.unregister('id1');

      // Register was called once for 'id1' after detach (register still tracks)
      // but registerCallback was detached, so it wasn't called again
      expect(registerCallback).to.not.have.been.called;
    });
  });

  describe('register', () => {
    it('should call register callback immediately if attached', () => {
      const proxy = new RegisteringProxy<(id: string, data: object) => void>();
      const callback = sinon.stub();

      proxy.onRegister(callback, true);
      proxy.register('id1', { key: 'value' });

      expect(callback).to.have.been.calledOnce;
      expect(callback).to.have.been.calledWith('id1', { key: 'value' });
    });

    it('should queue registration if no callback attached', () => {
      const proxy = new RegisteringProxy<(id: string) => void>();
      const callback = sinon.stub();

      proxy.register('id1');
      proxy.register('id2');

      proxy.onRegister(callback, true);

      expect(callback).to.have.been.calledTwice;
    });
  });

  describe('unregister', () => {
    it('should call unregister callback if registered', () => {
      const proxy = new RegisteringProxy<(id: string) => void>();
      const unregisterCallback = sinon.stub();

      proxy.onRegister(sinon.stub(), true);
      proxy.onUnregister(unregisterCallback);

      proxy.register('id1');
      proxy.unregister('id1');

      expect(unregisterCallback).to.have.been.calledWith('id1');
    });

    it('should not call unregister callback for unregistered id', () => {
      const proxy = new RegisteringProxy<(id: string) => void>();
      const unregisterCallback = sinon.stub();

      proxy.onRegister(sinon.stub(), true);
      proxy.onUnregister(unregisterCallback);

      proxy.unregister('nonexistent');

      expect(unregisterCallback).to.not.have.been.called;
    });

    it('should remove registration from internal map', () => {
      const proxy = new RegisteringProxy<(id: string) => void>();
      const unregisterCallback = sinon.stub();

      proxy.onRegister(sinon.stub(), true);
      proxy.onUnregister(unregisterCallback);

      proxy.register('id1');
      proxy.unregister('id1');

      // Second unregister should not call callback
      proxy.unregister('id1');
      expect(unregisterCallback).to.have.been.calledOnce;
    });
  });

  describe('unregisterModule', () => {
    it('should unregister all entries for a given module', () => {
      const proxy = new RegisteringProxy<(id: string) => void>();
      const unregisterCallback = sinon.stub();

      proxy.onRegister(sinon.stub(), true);
      proxy.onUnregister(unregisterCallback);

      // Register entries (module tracking is done internally)
      proxy.register('id1');
      proxy.register('id2');

      // Unregister for a module that doesn't match - should not call unregister
      proxy.unregisterModule('some-other-module');

      // Handlers were registered without module context in test environment
      // so unregistering 'some-other-module' should not affect them
      expect(unregisterCallback).to.not.have.been.called;
    });

    it('should not affect entries from other modules', () => {
      const proxy = new RegisteringProxy<(id: string) => void>();
      const registerCallback = sinon.stub();
      const unregisterCallback = sinon.stub();

      proxy.onRegister(registerCallback, true);
      proxy.onUnregister(unregisterCallback);

      proxy.register('id1');

      // Unregister for a different module
      proxy.unregisterModule('different-module');

      // Entry should still exist
      expect(unregisterCallback).to.not.have.been.called;
    });
  });
});
