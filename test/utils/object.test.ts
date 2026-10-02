import { expect } from "chai";

import { diffDeep, mergeDeep, set } from "../../src/utils/object";

describe("Object Utilities", () => {
  describe("mergeDeep", () => {
    it("should merge nested objects", () => {
      const target = { a: { b: 1, c: 2 } };
      const source = { a: { c: 3, d: 4 } };

      const result = mergeDeep(target, source);

      expect(result).to.deep.equal({ a: { b: 1, c: 3, d: 4 } });
    });

    it("should replace arrays instead of merging", () => {
      const target = { arr: [1, 2] };
      const source = { arr: [3, 4, 5] };

      const result = mergeDeep(target, source);

      expect(result).to.deep.equal({ arr: [3, 4, 5] });
    });

    it("skips undefined sources", () => {
      const target = { a: 1 };
      const result = mergeDeep(target, undefined, { b: 2 });

      expect(result).to.deep.equal({ a: 1, b: 2 });
    });
  });

  describe("diffDeep", () => {
    it("keeps only the keys whose value changed", () => {
      const before = { a: 1, b: { c: 2, d: [1] }, e: "same" };
      const after = { a: 1, b: { c: 3, d: [1] }, e: "same" };

      expect(diffDeep(before, after)).to.deep.equal({ b: { c: 3 } });
    });

    it("compares arrays by content and keeps new keys", () => {
      const before = { list: ["a"], nested: {} };
      const after = { list: ["a", "b"], nested: { added: true } };

      expect(diffDeep(before, after)).to.deep.equal({
        list: ["a", "b"],
        nested: { added: true },
      });
    });

    it("returns an empty object when nothing changed", () => {
      const value = { a: { b: [1, 2] } };

      expect(diffDeep(value, structuredClone(value))).to.deep.equal({});
    });
  });

  describe("set", () => {
    it("should set nested value by path", () => {
      const obj: Record<string, any> = { a: { b: 1 } };
      set(obj, "a.c.d", 42);
      expect(obj.a.c.d).to.equal(42);
    });
  });
});
