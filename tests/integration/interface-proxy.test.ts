import { expect, sinon } from '../helpers/setup';
import {
  AsyncProxy,
  RegisteringProxy,
  EventProxy,
  InterfaceFunction,
  ImplementInterface,
} from '../../src/interfaces/core/beta';

describe('Integration: Interface Proxy System', () => {
  describe('AsyncProxy workflow', () => {
    it('should queue calls until callback is attached', async () => {
      const proxy = new AsyncProxy<(x: number) => number>();
      const results: number[] = [];

      // Queue multiple calls
      const promise1 = proxy.call(1).then((r) => results.push(r));
      const promise2 = proxy.call(2).then((r) => results.push(r));
      const promise3 = proxy.call(3).then((r) => results.push(r));

      // Attach callback
      proxy.onCall((x) => x * 10, true);

      await Promise.all([promise1, promise2, promise3]);

      expect(results).to.include(10);
      expect(results).to.include(20);
      expect(results).to.include(30);
    });

    it('should handle detach and reattach', async () => {
      const proxy = new AsyncProxy<() => string>();

      proxy.onCall(() => 'first', true);
      expect(await proxy.call()).to.equal('first');

      proxy.detach();
      const pendingCall = proxy.call();

      proxy.onCall(() => 'second', true);
      expect(await pendingCall).to.equal('second');
    });
  });

  describe('RegisteringProxy workflow', () => {
    it('should maintain registrations across callback changes', () => {
      const proxy = new RegisteringProxy<(id: string, data: any) => void>();
      const registerCalls: any[] = [];
      const unregisterCalls: string[] = [];

      // Register before callback
      proxy.register('id1', { value: 1 });
      proxy.register('id2', { value: 2 });

      // Attach callbacks
      proxy.onRegister((id, data) => registerCalls.push({ id, data }), true);
      proxy.onUnregister((id) => unregisterCalls.push(id));

      // Should have processed pending registrations
      expect(registerCalls).to.have.length(2);
      expect(registerCalls[0].id).to.equal('id1');
      expect(registerCalls[1].id).to.equal('id2');

      // Unregister
      proxy.unregister('id1');
      expect(unregisterCalls).to.include('id1');
    });
  });

  describe('EventProxy workflow', () => {
    it('should manage multiple handlers', () => {
      const proxy = new EventProxy<(message: string, count: number) => void>();
      const handler1Calls: any[] = [];
      const handler2Calls: any[] = [];

      proxy.register((msg, count) => handler1Calls.push({ msg, count }));
      proxy.register((msg, count) => handler2Calls.push({ msg, count }));

      proxy.emit('test', 42);

      expect(handler1Calls).to.deep.equal([{ msg: 'test', count: 42 }]);
      expect(handler2Calls).to.deep.equal([{ msg: 'test', count: 42 }]);

      // Unregister one handler
      proxy.unregister(handler1Calls[0]); // This won't work as we stored result not function

      // Clear and re-test with function references
      const fn1 = sinon.stub();
      const fn2 = sinon.stub();

      const proxy2 = new EventProxy<() => void>();
      proxy2.register(fn1);
      proxy2.register(fn2);

      proxy2.emit();
      expect(fn1).to.have.been.calledOnce;
      expect(fn2).to.have.been.calledOnce;

      proxy2.unregister(fn1);
      proxy2.emit();
      expect(fn1).to.have.been.calledOnce; // Still once
      expect(fn2).to.have.been.calledTwice;
    });
  });

  describe('InterfaceFunction integration', () => {
    it('should create callable interface function', async () => {
      const myFunc = InterfaceFunction<(a: string, b: number) => string>();

      // Implement through proxy
      (myFunc as any).proxy.onCall((a: string, b: number) => `${a}-${b}`, true);

      const result = await myFunc('test', 123);
      expect(result).to.equal('test-123');
    });

    it('should handle async implementations', async () => {
      const asyncFunc = InterfaceFunction<() => Promise<string>>();

      (asyncFunc as any).proxy.onCall(async () => {
        return 'async result';
      }, true);

      const result = await asyncFunc();
      expect(result).to.equal('async result');
    });
  });

  describe('ImplementInterface integration', () => {
    it('should wire up interface with implementation', async () => {
      const getUser = InterfaceFunction<(id: number) => { name: string }>();
      const saveUser = InterfaceFunction<(user: { name: string }) => boolean>();

      const interface_ = { getUser, saveUser };

      const implementation = {
        getUser: (id: number) => ({ name: `User ${id}` }),
        saveUser: (user: { name: string }) => true,
      };

      ImplementInterface(interface_, implementation);

      expect(await getUser(1)).to.deep.equal({ name: 'User 1' });
      expect(await saveUser({ name: 'Test' })).to.be.true;
    });

    it('should handle nested interfaces', async () => {
      const nested = {
        operations: {
          add: InterfaceFunction<(a: number, b: number) => number>(),
          subtract: InterfaceFunction<(a: number, b: number) => number>(),
        },
      };

      const impl = {
        operations: {
          add: (a: number, b: number) => a + b,
          subtract: (a: number, b: number) => a - b,
        },
      };

      ImplementInterface(nested, impl);

      expect(await nested.operations.add(5, 3)).to.equal(8);
      expect(await nested.operations.subtract(5, 3)).to.equal(2);
    });

    it('should handle RegisteringProxy in interfaces', () => {
      const onDataReceived = new RegisteringProxy<(id: string, handler: (data: any) => void) => void>();

      const interface_ = { onDataReceived };

      const handlers = new Map<string, (data: any) => void>();
      const impl = {
        onDataReceived: {
          register: (id: string, handler: (data: any) => void) => handlers.set(id, handler),
          unregister: (id: string) => handlers.delete(id),
        },
      };

      ImplementInterface(interface_, impl);

      const dataHandler = sinon.stub();
      onDataReceived.register('handler1', dataHandler);

      // Verify handler was registered
      expect(handlers.has('handler1')).to.be.true;

      // Call the registered handler
      handlers.get('handler1')!({ value: 42 });
      expect(dataHandler).to.have.been.calledWith({ value: 42 });
    });
  });
});
