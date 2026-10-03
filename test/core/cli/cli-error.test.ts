import sinon from "sinon";
import { expect } from "chai";

import * as cliUi from "../../../src/core/cli/cli-ui";
import { stripAnsi } from "../../../src/core/cli/logging-utils";
import { CliError, reportCliError } from "../../../src/core/cli/cli-error";
import {
  FAILURE_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../../src/core/cli/exit-codes";

describe("CliError", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("fails with the generic failure exit code by default", () => {
    const cliError = new CliError({ title: "Something failed" });

    expect(cliError.message).to.equal("Something failed");
    expect(cliError.name).to.equal("CliError");
    expect(cliError.exitCode).to.equal(FAILURE_EXIT_CODE);
  });

  it("reports the title, the reason and every fix with its exit code", () => {
    const errorStub = sinon.stub(cliUi, "error");
    const consoleErrorStub = sinon.stub(console, "error");

    reportCliError(
      new CliError({
        title: "Unknown environment 'staging'",
        reason: "Known environments: default",
        fixes: ["Pass one of them with --env", "Or add it"],
        exitCode: USAGE_EXIT_CODE,
      }),
    );

    expect(errorStub.calledOnceWith("Unknown environment 'staging'")).to.equal(
      true,
    );
    const details = consoleErrorStub.args.map((args) =>
      stripAnsi(String(args[0])),
    );
    expect(details).to.deep.equal([
      "  Known environments: default",
      "  → Pass one of them with --env",
      "  → Or add it",
    ]);
    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
  });

  it("reports a bare title", () => {
    const errorStub = sinon.stub(cliUi, "error");
    const consoleErrorStub = sinon.stub(console, "error");

    reportCliError(new CliError({ title: "Something failed" }));

    expect(errorStub.calledOnce).to.equal(true);
    expect(consoleErrorStub.called).to.equal(false);
    expect(process.exitCode).to.equal(FAILURE_EXIT_CODE);
  });
});
