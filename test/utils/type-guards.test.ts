import { expect } from "chai";

import {
  isBoolean,
  isFunction,
  isNumber,
  isObjectOrNull,
  isString,
  isSymbol,
} from "../../src/utils";

describe("type guards", () => {
  it("separates primitives from their boxed objects", () => {
    expect(isString("")).to.equal(true);
    expect(isString(new String(""))).to.equal(false);
    expect(isNumber(Number.NaN)).to.equal(true);
    expect(isNumber(new Number(1))).to.equal(false);
    expect(isBoolean(false)).to.equal(true);
    expect(isBoolean(new Boolean(false))).to.equal(false);
    expect(isSymbol(Symbol("tag"))).to.equal(true);
    expect(isSymbol("tag")).to.equal(false);
  });

  it("treats classes and arrow functions as functions", () => {
    expect(isFunction(class Example {})).to.equal(true);
    expect(isFunction(() => undefined)).to.equal(true);
    expect(isFunction({ call: () => undefined })).to.equal(false);
  });

  it("keeps null and arrays in the object tag, and functions out of it", () => {
    expect(isObjectOrNull(null)).to.equal(true);
    expect(isObjectOrNull([])).to.equal(true);
    expect(isObjectOrNull(() => undefined)).to.equal(false);
    expect(isObjectOrNull(undefined)).to.equal(false);
  });
});
