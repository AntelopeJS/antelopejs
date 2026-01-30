import { expect } from '../../helpers/setup';
import { isObject, mergeDeep } from '../../../src/utils/object';

describe('utils/object', () => {
  describe('isObject', () => {
    it('should return true for plain objects', () => {
      expect(isObject({})).to.be.true;
      expect(isObject({ key: 'value' })).to.be.true;
    });

    it('should return falsy for null', () => {
      expect(isObject(null)).to.not.be.ok;
    });

    it('should return falsy for arrays', () => {
      expect(isObject([])).to.not.be.ok;
      expect(isObject([1, 2, 3])).to.not.be.ok;
    });

    it('should return falsy for primitives', () => {
      expect(isObject('string')).to.not.be.ok;
      expect(isObject(123)).to.not.be.ok;
      expect(isObject(true)).to.not.be.ok;
      expect(isObject(undefined)).to.not.be.ok;
    });
  });

  describe('mergeDeep', () => {
    it('should merge simple objects', () => {
      const target = { a: 1 };
      const source = { b: 2 };
      const result = mergeDeep(target, source);
      expect(result).to.deep.equal({ a: 1, b: 2 });
    });

    it('should merge nested objects', () => {
      const target = { a: { b: 1 } };
      const source = { a: { c: 2 } };
      const result = mergeDeep(target, source);
      expect(result).to.deep.equal({ a: { b: 1, c: 2 } });
    });

    it('should override primitive values', () => {
      const target = { a: 1 };
      const source = { a: 2 };
      const result = mergeDeep(target, source);
      expect(result).to.deep.equal({ a: 2 });
    });

    it('should handle multiple sources', () => {
      const target = { a: 1 };
      const source1 = { b: 2 };
      const source2 = { c: 3 };
      const result = mergeDeep(target, source1, source2);
      expect(result).to.deep.equal({ a: 1, b: 2, c: 3 });
    });

    it('should replace arrays instead of merging', () => {
      const target = { arr: [1, 2] };
      const source = { arr: [3, 4] };
      const result = mergeDeep(target, source);
      expect(result).to.deep.equal({ arr: [3, 4] });
    });

    it('should handle empty objects', () => {
      const target = {};
      const source = { a: 1 };
      const result = mergeDeep(target, source);
      expect(result).to.deep.equal({ a: 1 });
    });

    it('should deeply nest multiple levels', () => {
      const target = { a: { b: { c: 1 } } };
      const source = { a: { b: { d: 2 } } };
      const result = mergeDeep(target, source);
      expect(result).to.deep.equal({ a: { b: { c: 1, d: 2 } } });
    });
  });
});
