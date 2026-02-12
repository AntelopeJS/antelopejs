import { expect } from 'chai';
import { AsyncProxy, RegisteringProxy, internal } from '../../../../src/interfaces/core/beta';

describe('test stub mode', () => {
  afterEach(() => {
    internal.testStubMode = false;
  });

  describe('AsyncProxy', () => {
    it('rejects with error when called without callback in stub mode', async () => {
      internal.testStubMode = true;
      const proxy = new AsyncProxy();

      let thrown: unknown;
      try {
        await proxy.call();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).to.be.instanceOf(Error);
      expect((thrown as Error).message).to.include('without implementation');
    });

    it('still queues calls when stub mode is off', () => {
      const proxy = new AsyncProxy();
      const promise = proxy.call('arg');
      expect(promise).to.be.instanceOf(Promise);
    });

    it('calls callback normally when attached in stub mode', async () => {
      internal.testStubMode = true;
      const proxy = new AsyncProxy<(value: string) => string>();
      proxy.onCall((value) => value.toUpperCase(), true);

      const result = await proxy.call('hello');
      expect(result).to.equal('HELLO');
    });
  });

  describe('RegisteringProxy', () => {
    it('throws when registering without callback in stub mode', () => {
      internal.testStubMode = true;
      const proxy = new RegisteringProxy<(id: string) => void>();

      expect(() => proxy.register('id1')).to.throw('without implementation');
    });

    it('still queues registration when stub mode is off', () => {
      const proxy = new RegisteringProxy<(id: string) => void>();
      proxy.register('id1');
    });

    it('registers normally when callback attached in stub mode', () => {
      internal.testStubMode = true;
      const proxy = new RegisteringProxy<(id: string) => void>();
      const registered: string[] = [];
      proxy.onRegister((id) => registered.push(id), true);

      proxy.register('id1');

      expect(registered).to.deep.equal(['id1']);
    });
  });
});
