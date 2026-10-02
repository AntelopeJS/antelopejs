import { expect } from "chai";

import {
  CancelledError,
  CliError,
  describeMissingInput,
  NeedsInputError,
  reportCliError,
} from "../../../../src/core/cli/output";
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

describe("NeedsInputError", () => {
  it("names the flags to pass with the usage exit code", () => {
    const { ui, feedback } = createMemoryUi();

    reportCliError(
      new NeedsInputError({
        command: "ajs project init demo",
        flags: ["--name <name>", "--pm <npm|yarn|pnpm>"],
        defaultsFlag: "--yes",
      }),
      ui,
    );

    expect(feedback.text).to.equal(
      [
        "✖ Cannot prompt: this is not an interactive terminal",
        "  ajs project init demo needs answers it cannot ask for when stdin is not a terminal or CI is set.",
        "  → Pass them as flags: ajs project init demo --name <name> --pm <npm|yarn|pnpm>",
        "  → Or accept the defaults: ajs project init demo --yes",
        "",
      ].join("\n"),
    );
    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
  });

  it("does not suggest the defaults flag twice", () => {
    const problem = describeMissingInput({
      command: "ajs config reset",
      flags: ["--yes"],
      defaultsFlag: "--yes",
    });

    expect(problem.reason).to.include("needs an answer");
    expect(problem.fixes).to.deep.equal([
      "Pass it as a flag: ajs config reset --yes",
    ]);
  });

  it("asks for a terminal when no flag answers the question", () => {
    const problem = describeMissingInput({ command: "ajs", flags: [] });

    expect(problem.fixes).to.deep.equal([
      "Run it again in an interactive terminal",
    ]);
  });

  it("keeps the fixes the command gives", () => {
    const error = new NeedsInputError({
      command: "ajs project logging set",
      flags: ["--enable"],
      fixes: ["Pass the settings to change"],
    });

    expect(error.name).to.equal("NeedsInputError");
    expect(error).to.be.instanceOf(CliError);
    expect(error.problem.fixes).to.deep.equal(["Pass the settings to change"]);
  });
});

describe("CancelledError", () => {
  it("is reported as Cancelled", () => {
    const error = new CancelledError();

    expect(error.name).to.equal("CancelledError");
    expect(error.message).to.equal("Cancelled");
  });
});
