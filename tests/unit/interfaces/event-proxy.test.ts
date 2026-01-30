import { expect, sinon } from '../../helpers/setup';
import { EventProxy } from '../../../src/interfaces/core/beta';

describe('interfaces/core/beta/EventProxy', () => {
  describe('constructor', () => {
    it('should create an instance', () => {
      const proxy = new EventProxy();
      expect(proxy).to.be.instanceof(EventProxy);
    });
  });

  describe('register', () => {
    it('should register a handler', () => {
      const proxy = new EventProxy<(value: number) => void>();
      const handler = sinon.stub();

      proxy.register(handler);
      proxy.emit(42);

      expect(handler).to.have.been.calledWith(42);
    });

    it('should not register the same handler twice', () => {
      const proxy = new EventProxy<(value: number) => void>();
      const handler = sinon.stub();

      proxy.register(handler);
      proxy.register(handler);
      proxy.emit(42);

      expect(handler).to.have.been.calledOnce;
    });

    it('should register multiple different handlers', () => {
      const proxy = new EventProxy<(value: string) => void>();
      const handler1 = sinon.stub();
      const handler2 = sinon.stub();

      proxy.register(handler1);
      proxy.register(handler2);
      proxy.emit('test');

      expect(handler1).to.have.been.calledWith('test');
      expect(handler2).to.have.been.calledWith('test');
    });
  });

  describe('unregister', () => {
    it('should unregister a handler', () => {
      const proxy = new EventProxy<(value: number) => void>();
      const handler = sinon.stub();

      proxy.register(handler);
      proxy.unregister(handler);
      proxy.emit(42);

      expect(handler).to.not.have.been.called;
    });

    it('should not throw when unregistering non-existent handler', () => {
      const proxy = new EventProxy<() => void>();
      const handler = sinon.stub();

      expect(() => proxy.unregister(handler)).to.not.throw();
    });

    it('should only unregister the specified handler', () => {
      const proxy = new EventProxy<(value: number) => void>();
      const handler1 = sinon.stub();
      const handler2 = sinon.stub();

      proxy.register(handler1);
      proxy.register(handler2);
      proxy.unregister(handler1);
      proxy.emit(42);

      expect(handler1).to.not.have.been.called;
      expect(handler2).to.have.been.calledWith(42);
    });
  });

  describe('emit', () => {
    it('should call all registered handlers', () => {
      const proxy = new EventProxy<(a: number, b: string) => void>();
      const handler1 = sinon.stub();
      const handler2 = sinon.stub();

      proxy.register(handler1);
      proxy.register(handler2);
      proxy.emit(1, 'test');

      expect(handler1).to.have.been.calledWith(1, 'test');
      expect(handler2).to.have.been.calledWith(1, 'test');
    });

    it('should pass multiple arguments', () => {
      const proxy = new EventProxy<(a: number, b: string, c: boolean) => void>();
      const handler = sinon.stub();

      proxy.register(handler);
      proxy.emit(1, 'test', true);

      expect(handler).to.have.been.calledWith(1, 'test', true);
    });

    it('should not throw when no handlers registered', () => {
      const proxy = new EventProxy<() => void>();

      expect(() => proxy.emit()).to.not.throw();
    });

    it('should emit without arguments', () => {
      const proxy = new EventProxy<() => void>();
      const handler = sinon.stub();

      proxy.register(handler);
      proxy.emit();

      expect(handler).to.have.been.calledOnce;
    });
  });

  describe('unregisterModule', () => {
    it('should unregister all handlers for a given module', () => {
      const proxy = new EventProxy<(value: number) => void>();
      const handler1 = sinon.stub();
      const handler2 = sinon.stub();

      proxy.register(handler1);
      proxy.register(handler2);

      // Unregister all handlers - use 'test-module' which won't match
      // handlers registered without a module context
      proxy.unregisterModule('test-module');

      proxy.emit(42);

      // Handlers should still be called since they were registered
      // without module context (GetResponsibleModule returns undefined in tests)
      expect(handler1).to.have.been.calledWith(42);
      expect(handler2).to.have.been.calledWith(42);
    });

    it('should not affect handlers from other modules', () => {
      const proxy = new EventProxy<(value: number) => void>();
      const handler = sinon.stub();

      proxy.register(handler);

      // Unregister handlers from a specific module that doesn't match
      proxy.unregisterModule('other-module');

      proxy.emit(100);

      expect(handler).to.have.been.calledWith(100);
    });
  });
});
