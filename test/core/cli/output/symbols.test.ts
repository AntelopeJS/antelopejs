import { expect } from "chai";

import { SYMBOL_SETS, selectSymbols } from "../../../../src/core/output/index";

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

describe("output symbols", () => {
  it("draws every ASCII symbol with printable ASCII only", () => {
    const { levels, spinner, ...marks } = SYMBOL_SETS.ascii;
    const symbols = [
      ...Object.values(marks),
      ...spinner,
      ...Object.values(levels),
    ];

    expect(symbols).to.have.length.above(0);
    symbols.forEach((symbol) => {
      expect(symbol).to.be.a("string");
      expect(symbol).to.match(PRINTABLE_ASCII);
    });
  });

  it("gives both sets the same symbols", () => {
    expect(Object.keys(SYMBOL_SETS.ascii)).to.deep.equal(
      Object.keys(SYMBOL_SETS.unicode),
    );
    expect(Object.keys(SYMBOL_SETS.ascii.levels)).to.deep.equal(
      Object.keys(SYMBOL_SETS.unicode.levels),
    );
  });

  it("joins, cuts and points with a symbol of the set", () => {
    expect(selectSymbols(true)).to.include({
      separator: " · ",
      ellipsis: "…",
      arrow: "→",
    });
    expect(selectSymbols(false)).to.include({
      separator: " - ",
      ellipsis: "...",
      arrow: "->",
    });
  });
});
