import { expect, sinon } from '../../helpers/setup';
import { AsyncProxy } from '../../../src/interfaces/core/beta';

describe('interfaces/core/beta/AsyncProxy', () => {
  describe('constructor', () => {
    it('should create an instance', () => {
      const proxy = new AsyncProxy();
      expect(proxy).to.be.instanceof(AsyncProxy);
    });
  });

  describe('onCall', () => {
    it('should attach a callback', () => {
      const proxy = new AsyncProxy<(x: number) => number>();
      const callback = (x: number) => x * 2;

      proxy.onCall(callback, true);
      // Verify callback is attached by calling it
      return proxy.call(5).then((result) => {
        expect(result).to.equal(10);
      });
    });

    it('should execute queued calls when callback is attached', async () => {
      const proxy = new AsyncProxy<(x: number) => number>();

      // Queue a call before attaching callback
      const promise = proxy.call(5);

      // Attach callback
      proxy.onCall((x: number) => x * 2, true);

      const result = await promise;
      expect(result).to.equal(10);
    });

    it('should handle multiple queued calls', async () => {
      const proxy = new AsyncProxy<(x: number) => number>();

      const promise1 = proxy.call(1);
      const promise2 = proxy.call(2);
      const promise3 = proxy.call(3);

      proxy.onCall((x: number) => x * 10, true);

      const results = await Promise.all([promise1, promise2, promise3]);
      expect(results).to.deep.equal([10, 20, 30]);
    });

    it('should reject queued calls if callback throws', async () => {
      const proxy = new AsyncProxy<(x: number) => number>();

      const promise = proxy.call(5);

      proxy.onCall(() => {
        throw new Error('callback error');
      }, true);

      try {
        await promise;
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.message).to.equal('callback error');
      }
    });
  });

  describe('detach', () => {
    it('should detach the callback', async () => {
      const proxy = new AsyncProxy<(x: number) => number>();

      proxy.onCall((x: number) => x * 2, true);
      proxy.detach();

      // After detach, call should queue
      const promise = proxy.call(5);

      // Reattach to verify it was queued
      proxy.onCall((x: number) => x * 3, true);

      const result = await promise;
      expect(result).to.equal(15); // 5 * 3, not 5 * 2
    });
  });

  describe('call', () => {
    it('should return a Promise', () => {
      const proxy = new AsyncProxy();
      const result = proxy.call();
      expect(result).to.be.instanceof(Promise);
    });

    it('should resolve immediately when callback is attached', async () => {
      const proxy = new AsyncProxy<() => string>();
      proxy.onCall(() => 'result', true);

      const result = await proxy.call();
      expect(result).to.equal('result');
    });

    it('should handle async callbacks', async () => {
      const proxy = new AsyncProxy<() => Promise<string>>();
      proxy.onCall(async () => 'async result', true);

      const result = await proxy.call();
      expect(result).to.equal('async result');
    });

    it('should pass multiple arguments', async () => {
      const proxy = new AsyncProxy<(a: number, b: string, c: boolean) => string>();
      proxy.onCall((a, b, c) => `${a}-${b}-${c}`, true);

      const result = await proxy.call(1, 'test', true);
      expect(result).to.equal('1-test-true');
    });

    it('should queue calls when no callback is attached', () => {
      const proxy = new AsyncProxy<() => void>();

      // This should not throw, just queue
      const promise = proxy.call();
      expect(promise).to.be.instanceof(Promise);
    });
  });
});
