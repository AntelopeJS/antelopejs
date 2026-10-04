import { expect } from "chai";

import {
  isVerboseRun,
  normalizeVerboseArguments,
} from "../../../../src/core/cli/output";

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

describe("normalizeVerboseArguments", () => {
  const MATRIX: [string[], string[]][] = [
    [
      ["--verbose", "project", "dev"],
      ["--verbose=*", "project", "dev"],
    ],
    [
      ["project", "dev", "--verbose"],
      ["project", "dev", "--verbose=*"],
    ],
    [
      ["--verbose=loader,cli", "project", "dev"],
      ["--verbose=loader,cli", "project", "dev"],
    ],
    [
      ["--verbose", "--no-color", "dms", "dev"],
      ["--verbose=*", "--no-color", "dms", "dev"],
    ],
    [
      ["project", "dev", "--verbose", "loader"],
      ["project", "dev", "--verbose=*", "loader"],
    ],
    [
      ["module", "test", "--", "--verbose"],
      ["module", "test", "--", "--verbose"],
    ],
    [["--verbosely"], ["--verbosely"]],
  ];

  MATRIX.forEach(([args, expected]) =>
    it(`reads ${args.join(" ")} as ${expected.join(" ")}`, () => {
      expect(normalizeVerboseArguments(args)).to.deep.equal(expected);
    }),
  );
});
