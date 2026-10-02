import { expect } from "chai";

import { isVerboseRun } from "../../../../src/core/cli/output";

const BASE_ARGV = ["node", "ajs", "project", "build"];

describe("isVerboseRun", () => {
  it("is verbose with --verbose anywhere on the command line", () => {
    expect(isVerboseRun({ argv: [...BASE_ARGV, "--verbose"], env: {} })).to.equal(
      true,
    );
    expect(
      isVerboseRun({ argv: [...BASE_ARGV, "--verbose=loader"], env: {} }),
    ).to.equal(true);
  });

  it("is verbose when ANTELOPEJS_VERBOSE is set", () => {
    expect(
      isVerboseRun({ argv: BASE_ARGV, env: { ANTELOPEJS_VERBOSE: "loader" } }),
    ).to.equal(true);
  });

  it("is not verbose otherwise", () => {
    expect(isVerboseRun({ argv: BASE_ARGV, env: {} })).to.equal(false);
    expect(
      isVerboseRun({ argv: [...BASE_ARGV, "--verbosely"], env: {} }),
    ).to.equal(false);
  });

  it("reads the process by default", () => {
    const originalArgv = process.argv;
    process.argv = [...BASE_ARGV, "--verbose"];
    try {
      expect(isVerboseRun()).to.equal(true);
    } finally {
      process.argv = originalArgv;
    }
  });
});
