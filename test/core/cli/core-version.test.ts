import fs from "node:fs";
import sinon from "sinon";
import { expect } from "chai";

import {
  CORE_PACKAGE_NAME,
  getCoreVersion,
} from "../../../src/core/cli/core-version";

describe("Core version", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("names the core package", () => {
    expect(CORE_PACKAGE_NAME).to.equal("@antelopejs/core");
  });

  it("reads the version of the core package.json", () => {
    sinon
      .stub(fs, "readFileSync")
      .returns(JSON.stringify({ version: "9.9.9" }));

    expect(getCoreVersion()).to.equal("9.9.9");
  });

  it("falls back when the package.json cannot be read", () => {
    sinon.stub(fs, "readFileSync").throws(new Error("ENOENT"));

    expect(getCoreVersion()).to.equal("0.0.0");
  });

  it("falls back when the package.json has no version", () => {
    sinon.stub(fs, "readFileSync").returns(JSON.stringify({}));

    expect(getCoreVersion()).to.equal("0.0.0");
  });
});
