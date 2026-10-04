import { expect } from "chai";

import {
  isQuietRun,
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

describe("isQuietRun", () => {
  it("is quiet with -q or --quiet anywhere on the command line", () => {
    expect(isQuietRun({ argv: [...BASE_ARGV, "-q"], env: {} })).to.equal(true);
    expect(isQuietRun({ argv: [...BASE_ARGV, "--quiet"], env: {} })).to.equal(
      true,
    );
  });

  it("is quiet when ANTELOPEJS_QUIET is on", () => {
    expect(
      isQuietRun({ argv: BASE_ARGV, env: { ANTELOPEJS_QUIET: "1" } }),
    ).to.equal(true);
  });

  it("is not quiet otherwise", () => {
    expect(isQuietRun({ argv: BASE_ARGV, env: {} })).to.equal(false);
    expect(
      isQuietRun({ argv: BASE_ARGV, env: { ANTELOPEJS_QUIET: "false" } }),
    ).to.equal(false);
    expect(isQuietRun({ argv: [...BASE_ARGV, "--quietly"], env: {} })).to.equal(
      false,
    );
  });

  it("reads the process by default", () => {
    const originalArgv = process.argv;
    process.argv = [...BASE_ARGV, "-q"];
    try {
      expect(isQuietRun()).to.equal(true);
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
