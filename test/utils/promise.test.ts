import { expect } from 'chai';
import { Detour, CreateDetour } from '../../src/utils/promise';

describe('Promise Utilities', () => {
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

  describe('CreateDetour', () => {
    it('should allow swapping side effects', () => {
      const calls: number[] = [];
      const original = (x: number) => x + 1;
      const { fn, detour } = CreateDetour(original);

      detour((x) => calls.push(x));
      expect(fn(1)).to.equal(2);

      detour((x) => calls.push(x * 2));
      expect(fn(2)).to.equal(3);

      expect(calls).to.deep.equal([1, 4]);
    });

    it('should work without a detour', () => {
      const { fn } = CreateDetour((x: number) => x * 3);
      expect(fn(3)).to.equal(9);
    });
  });
});
