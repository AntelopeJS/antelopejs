import { expect } from "chai";

import { SYMBOL_SETS, selectSymbols } from "../../../../src/core/cli/output";

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

function symbolValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return Object.values(value as object).flatMap(symbolValues);
}

describe("output symbols", () => {
  it("draws every ASCII symbol with printable ASCII only", () => {
    const symbols = symbolValues(SYMBOL_SETS.ascii);

    expect(symbols).to.have.length.above(0);
    symbols.forEach((symbol) => expect(symbol).to.match(PRINTABLE_ASCII));
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
