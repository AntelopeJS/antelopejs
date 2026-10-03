import path from "node:path";
import { expect } from "chai";

import {
  createPalette,
  displayPath,
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

  it("shows paths relative to the working directory when inside it", () => {
    const cwd = path.resolve("/work/acme-shop");

    expect(displayPath(path.join(cwd, "modules", "auth"), cwd)).to.equal(
      `.${path.sep}${path.join("modules", "auth")}`,
    );
    expect(displayPath(path.resolve("/usr/bin/ajs-dms"), cwd)).to.equal(
      path.resolve("/usr/bin/ajs-dms"),
    );
    expect(displayPath(path.resolve("/work/acme-shop-2"), cwd)).to.equal(
      path.resolve("/work/acme-shop-2"),
    );
    expect(displayPath(cwd, cwd)).to.equal(cwd);
  });
});
