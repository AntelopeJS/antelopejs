import { expect } from '../../helpers/setup';
import { ResolveLater, Detour, CreateDetour } from '../../../src/utils/promise';

describe('utils/promise', () => {
  describe('ResolveLater', () => {
    it('should create a promise that can be resolved externally', async () => {
      const [promise, resolve] = ResolveLater<string>();

      setTimeout(() => resolve('resolved'), 10);

      const result = await promise;
      expect(result).to.equal('resolved');
    });

    it('should handle immediate resolution', async () => {
      const [promise, resolve] = ResolveLater<number>();
      resolve(42);

      const result = await promise;
      expect(result).to.equal(42);
    });

    it('should work with complex types', async () => {
      const [promise, resolve] = ResolveLater<{ key: string }>();
      resolve({ key: 'value' });

      const result = await promise;
      expect(result).to.deep.equal({ key: 'value' });
    });

    it('should work with undefined', async () => {
      const [promise, resolve] = ResolveLater<undefined>();
      resolve(undefined);

      const result = await promise;
      expect(result).to.be.undefined;
    });
  });

  describe('Detour', () => {
    it('should execute side effect and return value synchronously', () => {
      let sideEffectCalled = false;
      const detour = Detour<string>((value) => {
        sideEffectCalled = true;
      });

      const result = detour('test-value');

      expect(sideEffectCalled).to.be.true;
      expect(result).to.equal('test-value');
    });

    it('should pass the value to the side effect', () => {
      let capturedValue: string | undefined;
      const detour = Detour<string>((value) => {
        capturedValue = value;
      });

      detour('captured');

      expect(capturedValue).to.equal('captured');
    });

    it('should return the same value that was passed in', () => {
      const detour = Detour<number>((value) => {
        // side effect
      });

      const result = detour(42);

      expect(result).to.equal(42);
    });

    it('should work with numeric values', () => {
      let sum = 0;
      const detour = Detour<number>((value) => {
        sum += value;
      });

      detour(10);
      detour(20);

      expect(sum).to.equal(30);
    });

    it('should work with complex objects', () => {
      const collected: object[] = [];
      const detour = Detour<{ id: number }>((value) => {
        collected.push(value);
      });

      const obj = { id: 1 };
      const result = detour(obj);

      expect(result).to.equal(obj);
      expect(collected).to.deep.equal([obj]);
    });
  });

  describe('CreateDetour', () => {
    it('should create a detour that resolves a promise', async () => {
      let capturedPromise: Promise<string> | undefined;
      const detour = CreateDetour<string>((promise) => {
        capturedPromise = promise;
      });

      expect(capturedPromise).to.be.instanceof(Promise);

      detour('result');

      const result = await capturedPromise!;
      expect(result).to.equal('result');
    });

    it('should pass the promise to the callback immediately', () => {
      let callbackCalled = false;
      CreateDetour<number>((promise) => {
        callbackCalled = true;
        expect(promise).to.be.instanceof(Promise);
      });

      expect(callbackCalled).to.be.true;
    });

    it('should return a detour function', () => {
      const detour = CreateDetour<string>(() => {});

      expect(detour).to.be.a('function');
    });

    it('should resolve the promise when detour is called', async () => {
      let resolvedValue: number | undefined;
      const detour = CreateDetour<number>((promise) => {
        promise.then((val) => {
          resolvedValue = val;
        });
      });

      detour(123);

      // Allow promise to resolve
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(resolvedValue).to.equal(123);
    });

    it('should work with objects', async () => {
      let capturedPromise: Promise<{ id: number }> | undefined;
      const detour = CreateDetour<{ id: number }>((promise) => {
        capturedPromise = promise;
      });

      detour({ id: 1 });

      const result = await capturedPromise!;
      expect(result).to.deep.equal({ id: 1 });
    });
  });
});
