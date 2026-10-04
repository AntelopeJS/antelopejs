import { expect } from "chai";

import * as cli from "../../../src/core/cli/public";
import {
  CANCELLED_EXIT_CODE,
  FAILURE_EXIT_CODE,
  SUCCESS_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../../src/core/cli/exit-codes";
import { createUi } from "../../../src/core/cli/output/ui";
import { CliError } from "../../../src/core/cli/output/errors";
import { runWithErrorBoundary } from "../../../src/core/cli/output/boundary";

const PUBLIC_EXPORTS = [
  "CANCELLED_EXIT_CODE",
  "CancelledError",
  "CliError",
  "FAILURE_EXIT_CODE",
  "NeedsInputError",
  "SUCCESS_EXIT_CODE",
  "SYMBOL_SETS",
  "TaskList",
  "USAGE_EXIT_CODE",
  "applyHelpConventions",
  "createPrompter",
  "createUi",
  "detectCapabilities",
  "displayPath",
  "formatDuration",
  "formatExamples",
  "formatHelpItem",
  "formatUsageErrors",
  "getProcessPalette",
  "getProcessTasks",
  "getProcessUi",
  "helpTextWidth",
  "helpWidth",
  "isQuietRun",
  "isVerboseRun",
  "missingFlags",
  "pluralize",
  "processCapabilityContext",
  "runTask",
  "runWithErrorBoundary",
  "selectSymbols",
  "unbreakable",
  "withExamples",
  "wrapText",
  "writeData",
];

describe("@antelopejs/core/cli", () => {
  it("exposes exactly the public output API", () => {
    expect(Object.keys(cli).sort()).to.deep.equal(PUBLIC_EXPORTS);
    expect(Object.values(cli)).to.not.include(undefined);
  });

  it("exposes the same implementations as the core CLI", () => {
    expect(cli.createUi).to.equal(createUi);
    expect(cli.CliError).to.equal(CliError);
    expect(cli.runWithErrorBoundary).to.equal(runWithErrorBoundary);
  });

  it("exposes the exit code contract", () => {
    expect([
      cli.SUCCESS_EXIT_CODE,
      cli.FAILURE_EXIT_CODE,
      cli.USAGE_EXIT_CODE,
      cli.CANCELLED_EXIT_CODE,
    ]).to.deep.equal([
      SUCCESS_EXIT_CODE,
      FAILURE_EXIT_CODE,
      USAGE_EXIT_CODE,
      CANCELLED_EXIT_CODE,
    ]);
  });
});
