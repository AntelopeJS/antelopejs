import { expect } from "chai";

import { diffDeep, mergeDeep, set } from "../../src/utils";

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

    it("copies a __proto__ key from JSON as data and leaves the result's prototype alone", () => {
      const source = { ["__proto__"]: { polluted: true }, kept: 1 };

      const result = mergeDeep({ a: 1 }, source);

      expect(Object.getPrototypeOf(result)).to.equal(Object.prototype);
      expect(Object.hasOwn(result, "__proto__")).to.equal(true);
      expect(Object.hasOwn(result, "kept")).to.equal(true);
      expect("polluted" in result).to.equal(false);
    });

    it("replaces the inherited constructor when the source carries a plain-object constructor key", () => {
      const result = mergeDeep({}, { constructor: { name: "mine" } });

      expect(Object.getPrototypeOf(result)).to.equal(Object.prototype);
      expect(result.constructor).to.deep.equal({ name: "mine" });
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

    it("treats a key named like an Object.prototype member as absent from before", () => {
      expect(diffDeep({}, { toString: undefined })).to.deep.equal({});
      expect(diffDeep({}, { constructor: 1 })).to.deep.equal({
        constructor: 1,
      });
    });

    it("returns an empty object when nothing changed", () => {
      const value = { a: { b: [1, 2] } };

      expect(diffDeep(value, structuredClone(value))).to.deep.equal({});
    });
  });

  describe("set", () => {
    it("should set nested value by path", () => {
      interface NestedConfig {
        a: { b: number; c?: { d: number } };
      }
      const obj: NestedConfig = { a: { b: 1 } };
      set(obj, "a.c.d", 42);
      expect(obj.a.c?.d).to.equal(42);
    });

    describe("on values that are not plain objects", () => {
      it("assigns through the setter of a class instance", () => {
        class Pool {
          #max = 10;

          get max(): number {
            return this.#max;
          }

          set max(value: number | string) {
            this.#max = Number(value);
          }
        }
        const pool = new Pool();

        set({ db: { pool } }, "db.pool.max", "20");

        expect(pool.max).to.equal(20);
        expect(Object.hasOwn(pool, "max")).to.equal(false);
      });

      it("assigns through the setter of a built-in", () => {
        const api = new URL("http://a.example/");

        set({ api }, "api.host", "b.example");

        expect(api.href).to.equal("http://b.example/");
      });

      it("writes into the object an inherited getter returns", () => {
        const shared = { a: 1 };
        class Holder {
          get inner() {
            return shared;
          }
        }
        const holder = new Holder();

        set({ holder }, "holder.inner.x", "y");

        expect(shared).to.deep.equal({ a: 1, x: "y" });
        expect(Object.hasOwn(holder, "inner")).to.equal(false);
      });
    });

    describe("with a path segment named __proto__", () => {
      afterEach(() => {
        Reflect.deleteProperty(Object.prototype, "polluted");
      });

      it("stores it as data and leaves Object.prototype alone", () => {
        const obj = {};

        set(obj, "__proto__.polluted", "yes");

        expect(Object.hasOwn(Object.prototype, "polluted")).to.equal(false);
        expect(Object.getPrototypeOf(obj)).to.equal(Object.prototype);
        expect(Object.hasOwn(obj, "__proto__")).to.equal(true);
      });
    });
  });
});
