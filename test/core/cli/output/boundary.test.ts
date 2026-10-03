import sinon from "sinon";
import { expect } from "chai";
import { CommanderError } from "commander";

import {
  CancelledError,
  CliError,
  getProcessUi,
  runWithErrorBoundary,
} from "../../../../src/core/cli/output";
import { CANCELLED_MESSAGE } from "../../../../src/core/cli/cancellation";
import {
  CANCELLED_EXIT_CODE,
  FAILURE_EXIT_CODE,
  SUCCESS_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../../../src/core/cli/exit-codes";
import { createMemoryUi } from "../../../helpers/memory-ui";

const BUILD_EXIT_CODE = 3;

describe("runWithErrorBoundary", () => {
  afterEach(() => {
    process.exitCode = undefined;
    sinon.restore();
  });

  it("leaves the exit code of a successful run alone", async () => {
    const { ui, feedback } = createMemoryUi();

    await runWithErrorBoundary(async () => {
      process.exitCode = BUILD_EXIT_CODE;
    }, { ui });

    expect(process.exitCode).to.equal(BUILD_EXIT_CODE);
    expect(feedback.text).to.equal("");
  });

  it("reports a failure once with its exit code", async () => {
    const { ui, feedback } = createMemoryUi();

    await runWithErrorBoundary(
      () =>
        Promise.reject(
          new CliError({ title: "Bad input", exitCode: USAGE_EXIT_CODE }),
        ),
      { ui, verbose: false },
    );

    expect(feedback.text).to.equal("✖ Bad input\n");
    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
  });

  it("reports an unexpected failure with the failure exit code", async () => {
    const { ui, feedback } = createMemoryUi();

    await runWithErrorBoundary(() => Promise.reject(new Error("boom")), {
      ui,
      verbose: true,
    });

    expect(feedback.text.split("\n")[0]).to.equal("✖ boom");
    expect(feedback.text).to.contain("  Error: boom");
    expect(process.exitCode).to.equal(FAILURE_EXIT_CODE);
  });

  it("uses the process ui when none is given", async () => {
    const problemStub = sinon.stub(getProcessUi(), "problem");

    await runWithErrorBoundary(() => Promise.reject(new Error("boom")));

    expect(problemStub.calledOnce).to.equal(true);
  });

  it("reports a cancelled prompt with the cancelled exit code", async () => {
    const errorStub = sinon.stub(console, "error");
    const { ui, feedback } = createMemoryUi();

    await runWithErrorBoundary(
      () => Promise.reject(new CancelledError()),
      { ui },
    );

    expect(errorStub.calledOnceWith(CANCELLED_MESSAGE)).to.equal(true);
    expect(feedback.text).to.equal("");
    expect(process.exitCode).to.equal(CANCELLED_EXIT_CODE);
  });

  it("explains failures with the translate hook", async () => {
    const { ui, feedback } = createMemoryUi();

    await runWithErrorBoundary(() => Promise.reject(new Error("fetch failed")), {
      ui,
      verbose: false,
      translate: () => ({
        title: "Cannot reach http://localhost:5000",
        fixes: ["Start the backend, then try again"],
      }),
    });

    expect(feedback.text).to.equal(
      "✖ Cannot reach http://localhost:5000\n  → Start the backend, then try again\n",
    );
    expect(process.exitCode).to.equal(FAILURE_EXIT_CODE);
  });

  it("handles the errors of another copy of commander by their code", async () => {
    const { ui, feedback } = createMemoryUi();
    const helpExit = Object.assign(new Error("(outputHelp)"), {
      code: "commander.helpDisplayed",
      exitCode: SUCCESS_EXIT_CODE,
    });

    await runWithErrorBoundary(() => Promise.reject(helpExit), { ui });

    expect(process.exitCode).to.equal(SUCCESS_EXIT_CODE);
    expect(feedback.text).to.equal("");
  });

  it("reports an error whose code only looks like commander's", async () => {
    const { ui, feedback } = createMemoryUi();
    const lookalike = Object.assign(new Error("boom"), {
      code: "commander.help",
    });

    await runWithErrorBoundary(() => Promise.reject(lookalike), {
      ui,
      verbose: false,
    });

    expect(feedback.text.split("\n")[0]).to.equal("✖ boom");
    expect(process.exitCode).to.equal(FAILURE_EXIT_CODE);
  });

  it("reports a thrown value that is not an error", async () => {
    const { ui, feedback } = createMemoryUi();

    await runWithErrorBoundary(() => Promise.reject("boom"), {
      ui,
      verbose: false,
    });

    expect(feedback.text).to.equal("✖ boom\n");
    expect(process.exitCode).to.equal(FAILURE_EXIT_CODE);
  });

  it("keeps commander's help and version exits silent", async () => {
    const { ui, feedback } = createMemoryUi();

    await runWithErrorBoundary(
      () =>
        Promise.reject(
          new CommanderError(0, "commander.version", "1.0.0"),
        ),
      { ui },
    );
    expect(process.exitCode).to.equal(SUCCESS_EXIT_CODE);

    await runWithErrorBoundary(
      () =>
        Promise.reject(new CommanderError(1, "commander.help", "(outputHelp)")),
      { ui },
    );
    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(feedback.text).to.equal("");
  });
});
