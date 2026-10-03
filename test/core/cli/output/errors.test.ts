import { expect } from "chai";

import { CliError, reportCliError } from "../../../../src/core/cli/output";
import {
  FAILURE_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../../../src/core/cli/exit-codes";
import { createMemoryUi } from "../../../helpers/memory-ui";

describe("CliError", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("fails with the generic failure exit code by default", () => {
    const cliError = new CliError({ title: "Something failed" });

    expect(cliError.message).to.equal("Something failed");
    expect(cliError.name).to.equal("CliError");
    expect(cliError.exitCode).to.equal(FAILURE_EXIT_CODE);
  });

  it("reports the title, the reason and every fix with its exit code", () => {
    const { ui, result, feedback } = createMemoryUi();

    reportCliError(
      new CliError({
        title: "Unknown environment 'staging'",
        reason: "Known environments: default",
        fixes: ["Pass one of them with --env", "Or add it"],
        exitCode: USAGE_EXIT_CODE,
      }),
      ui,
    );

    expect(feedback.text).to.equal(
      [
        "✖ Unknown environment 'staging'",
        "  Known environments: default",
        "  → Pass one of them with --env",
        "  → Or add it",
        "",
      ].join("\n"),
    );
    expect(result.text).to.equal("");
    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
  });

  it("reports a bare title", () => {
    const { ui, feedback } = createMemoryUi();

    reportCliError(new CliError({ title: "Something failed" }), ui);

    expect(feedback.text).to.equal("✖ Something failed\n");
    expect(process.exitCode).to.equal(FAILURE_EXIT_CODE);
  });
});
