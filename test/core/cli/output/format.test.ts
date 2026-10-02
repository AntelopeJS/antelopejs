import { expect } from "chai";

import {
  createPalette,
  formatDuration,
  padVisible,
  pluralize,
  visibleWidth,
} from "../../../../src/core/cli/output";

describe("output format", () => {
  it("pluralizes regular and irregular nouns", () => {
    expect(pluralize(0, "module")).to.equal("0 modules");
    expect(pluralize(1, "module")).to.equal("1 module");
    expect(pluralize(2, "module")).to.equal("2 modules");
    expect(pluralize(2, "dependency", "dependencies")).to.equal(
      "2 dependencies",
    );
  });

  it("humanizes durations", () => {
    expect(formatDuration(850)).to.equal("850ms");
    expect(formatDuration(2100)).to.equal("2.1s");
    expect(formatDuration(65_000)).to.equal("1m 05s");
    expect(formatDuration(754_400)).to.equal("12m 34s");
  });

  it("measures and pads text without its color codes", () => {
    const palette = createPalette(true);
    const name = palette.bold("auth");

    expect(visibleWidth(name)).to.equal(4);
    expect(padVisible(name, 6)).to.equal(`${name}  `);
    expect(padVisible("inventory", 4)).to.equal("inventory");
  });

  it("paints nothing when colors are off", () => {
    const palette = createPalette(false);

    expect(Object.values(palette).map((paint) => paint("text"))).to.deep.equal(
      Array(Object.keys(palette).length).fill("text"),
    );
  });
});
