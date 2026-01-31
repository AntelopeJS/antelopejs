import { expect } from 'chai';
import { mergeDeep, get, set } from '../../src/utils/object';

describe('Object Utilities', () => {
  describe('mergeDeep', () => {
    it('should merge nested objects', () => {
      const target = { a: { b: 1, c: 2 } };
      const source = { a: { c: 3, d: 4 } };

      const result = mergeDeep(target, source);

      expect(result).to.deep.equal({ a: { b: 1, c: 3, d: 4 } });
    });

    it('should replace arrays instead of merging', () => {
      const target = { arr: [1, 2] };
      const source = { arr: [3, 4, 5] };

      const result = mergeDeep(target, source);

      expect(result).to.deep.equal({ arr: [3, 4, 5] });
    });
  });

  describe('get', () => {
    it('should get nested value by path', () => {
      const obj = { a: { b: { c: 42 } } };
      expect(get(obj, 'a.b.c')).to.equal(42);
    });

    it('should return undefined for missing path', () => {
      const obj = { a: 1 };
      expect(get(obj, 'a.b.c')).to.be.undefined;
    });
  });

  describe('set', () => {
    it('should set nested value by path', () => {
      const obj: Record<string, any> = { a: { b: 1 } };
      set(obj, 'a.c.d', 42);
      expect(obj.a.c.d).to.equal(42);
    });
  });
});
