import { expect } from 'chai';
import { ResolveLater, Detour } from '../../src/utils/promise';

describe('Promise Utilities', () => {
  describe('ResolveLater', () => {
    it('should create a deferred promise', async () => {
      const deferred = ResolveLater<number>();

      setTimeout(() => deferred.resolve(42), 10);

      const result = await deferred.promise;
      expect(result).to.equal(42);
    });

    it('should reject the promise', async () => {
      const deferred = ResolveLater<number>();

      setTimeout(() => deferred.reject(new Error('test error')), 10);

      try {
        await deferred.promise;
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).to.equal('test error');
      }
    });
  });

  describe('Detour', () => {
    it('should wrap a function with side effect', () => {
      let sideEffect = 0;
      const original = (x: number) => x * 2;
      const wrapped = Detour(original, () => {
        sideEffect++;
      });

      const result = wrapped(5);

      expect(result).to.equal(10);
      expect(sideEffect).to.equal(1);
    });
  });
});
