import { expect } from "chai";

import { isParsedJson } from "../../src/utils";

function sparseList(): unknown[] {
  const list: unknown[] = [];
  list[1] = 1;
  return list;
}

describe("isParsedJson", () => {
  it("accepts what JSON.parse returns, at every depth", () => {
    const parsed: unknown = JSON.parse(
      '{"a":[1,"x",true,null,{"b":{}}],"c":-0.5,"d":[[]],"e":1e308,"f":1e999,"g":[-1e999]}',
    );

    expect(isParsedJson(parsed)).to.equal(true);
  });

  for (const [label, value] of [
    ["undefined", undefined],
    ["a function", () => 1],
    ["a bigint", 1n],
    ["a Date", new Date(0)],
    ["a Map", new Map()],
    ["undefined under an object in a list", { list: [1, { leaf: undefined }] }],
    ["a symbol in a nested list", [[Symbol("leaf")]]],
    ["a Date in an object", { when: new Date(0) }],
    ["a list with a hole", { list: sparseList() }],
    ["NaN", Number.NaN],
    ["NaN under an object in a list", { list: [1, { leaf: Number.NaN }] }],
  ] as const) {
    it(`refuses ${label}`, () => {
      expect(isParsedJson(value)).to.equal(false);
    });
  }
});
