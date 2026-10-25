import { expect } from "chai";

import * as cli from "../../../src/core/cli/public";

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
});
