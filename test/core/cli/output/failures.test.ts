import { expect } from "chai";

import { ExecError } from "../../../../src/core/cli/command";
import {
  CliError,
  describeFailure,
  reportFailure,
} from "../../../../src/core/cli/output";
import {
  FAILURE_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../../../src/core/cli/exit-codes";
import { createMemoryUi } from "../../../helpers/memory-ui";

const COMMAND_OUTPUT_HINT = "Run with --verbose to see the command output.";
const STACK_TRACE_HINT = "Run with --verbose for the full trace.";

const TSC_OUTPUT = [
  "\u001b[41m\u001b[37m  This is not the tsc command you are looking for  \u001b[0m",
  "",
  "To get access to the TypeScript compiler, tsc, from the command line either:",
  "- Use npm install typescript to first add TypeScript to your project",
  "- Use yarn to avoid accidentally running code from un-installed packages",
].join("\n");

function tscFailure(): ExecError {
  return new ExecError({
    command: "npx tsc",
    stdout: "",
    stderr: TSC_OUTPUT,
    code: 1,
  });
}

function installFailure(): CliError {
  return new CliError(
    {
      title: "Failed to install dependencies for module-a",
      reason: "'npx tsc' exited with code 1.",
    },
    { cause: tscFailure() },
  );
}

describe("describeFailure", () => {
  it("keeps the problem of a command error that has no cause", () => {
    const problem = describeFailure(
      new CliError({ title: "Unknown environment 'staging'" }),
      false,
    );

    expect(problem).to.deep.equal({
      title: "Unknown environment 'staging'",
      details: [],
    });
  });

  it("shows the last lines of an untranslated command failure without its colors", () => {
    const problem = describeFailure(installFailure(), false);

    expect(problem.details).to.deep.equal([
      "Command output:",
      "  To get access to the TypeScript compiler, tsc, from the command line either:",
      "  - Use npm install typescript to first add TypeScript to your project",
      "  - Use yarn to avoid accidentally running code from un-installed packages",
      COMMAND_OUTPUT_HINT,
    ]);
  });

  it("shows the whole command output with --verbose", () => {
    const problem = describeFailure(installFailure(), true);

    expect(problem.details).to.deep.equal([
      "Output of 'npx tsc':",
      "    This is not the tsc command you are looking for",
      "  To get access to the TypeScript compiler, tsc, from the command line either:",
      "  - Use npm install typescript to first add TypeScript to your project",
      "  - Use yarn to avoid accidentally running code from un-installed packages",
    ]);
  });

  it("reports a command failure on its own with its exit code", () => {
    const problem = describeFailure(tscFailure(), false);

    expect(problem.title).to.equal(
      "Command 'npx tsc' failed with exit code 1",
    );
    expect(problem.details?.at(-1)).to.equal(COMMAND_OUTPUT_HINT);
  });

  it("omits the output of a translated command failure", () => {
    const problem = describeFailure(
      new ExecError({
        command: "npm view @acme/missing version",
        stdout: "",
        stderr: "npm error code E404",
        code: 1,
      }),
      false,
    );

    expect(problem.title).to.equal(
      "Package '@acme/missing' not found on the npm registry",
    );
    expect(problem.details).to.deep.equal([COMMAND_OUTPUT_HINT]);
  });

  it("does not print an output heading when the command said nothing", () => {
    const silent = new ExecError({
      command: "false",
      stdout: "",
      stderr: "",
      code: 1,
    });

    expect(describeFailure(silent, false).details).to.deep.equal([
      COMMAND_OUTPUT_HINT,
    ]);
  });

  it("reduces an unexpected error to the first line of its message", () => {
    const problem = describeFailure(
      new Error("\u001b[31mboom\u001b[39m\nsecond line"),
      false,
    );

    expect(problem).to.deep.equal({
      title: "boom",
      details: [STACK_TRACE_HINT],
    });
  });

  it("shows the stack of an unexpected error with --verbose", () => {
    const error = new Error("boom");
    const details = describeFailure(error, true).details ?? [];

    expect(details[0]).to.equal("Error: boom");
    expect(details.slice(1).every((line) => line.includes("at "))).to.equal(
      true,
    );
  });

  it("names an error that has no message", () => {
    expect(describeFailure(new TypeError(""), false).title).to.equal(
      "TypeError",
    );
  });

  it("does not offer a trace for a translated system error", () => {
    const missing = Object.assign(new Error("ENOENT: stat '/nope'"), {
      code: "ENOENT",
      path: "/nope",
    });

    expect(describeFailure(missing, false).details).to.deep.equal([]);
  });

  it("reports a thrown value that is not an error", () => {
    expect(describeFailure("boom", false)).to.deep.equal({
      title: "boom",
      details: [],
    });
    expect(describeFailure(undefined, false).title).to.equal("undefined");
  });

  it("explains a failure with the translate hook before the built-in translations", () => {
    const missing = Object.assign(new Error("ENOENT: stat '/nope'"), {
      code: "ENOENT",
      path: "/nope",
    });

    const problem = describeFailure(missing, false, () => ({
      title: "Manifest not found",
      fixes: ["Run ajs dms prepare first"],
    }));

    expect(problem).to.deep.equal({
      title: "Manifest not found",
      fixes: ["Run ajs dms prepare first"],
      details: [],
    });
  });

  it("falls back to the built-in description when the translate hook declines", () => {
    const problem = describeFailure(new Error("boom"), false, () => undefined);

    expect(problem).to.deep.equal({
      title: "boom",
      details: [STACK_TRACE_HINT],
    });
  });

  it("keeps the problem of a command error whatever the translate hook says", () => {
    const problem = describeFailure(
      new CliError({ title: "Unknown environment 'staging'" }),
      false,
      () => ({ title: "Translated" }),
    );

    expect(problem.title).to.equal("Unknown environment 'staging'");
  });

  it("does not offer a trace for a cause the translate hook explains", () => {
    const refused = new Error("connect ECONNREFUSED 127.0.0.1:5000");
    const failure = new CliError(
      { title: "Cannot reach the backend" },
      { cause: refused },
    );

    const problem = describeFailure(failure, false, (error) =>
      error === refused ? { title: "Backend refused the connection" } : undefined,
    );

    expect(problem.details).to.deep.equal([]);
  });

  it("follows a cyclic cause chain once", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    first.cause = second;

    expect(describeFailure(first, false).details).to.deep.equal([
      STACK_TRACE_HINT,
    ]);
  });
});

describe("reportFailure", () => {
  it("prints the problem once and returns its exit code", () => {
    const { ui, result, feedback } = createMemoryUi();

    const exitCode = reportFailure(
      new CliError({ title: "Bad input", exitCode: USAGE_EXIT_CODE }),
      ui,
      false,
    );

    expect(feedback.text).to.equal("✖ Bad input\n");
    expect(result.text).to.equal("");
    expect(exitCode).to.equal(USAGE_EXIT_CODE);
  });

  it("reports a failure explained by the translate hook with its exit code", () => {
    const { ui, feedback } = createMemoryUi();

    const exitCode = reportFailure(new Error("fetch failed"), ui, false, () => ({
      title: "Cannot reach http://localhost:5000",
      exitCode: USAGE_EXIT_CODE,
    }));

    expect(feedback.text).to.equal("✖ Cannot reach http://localhost:5000\n");
    expect(exitCode).to.equal(USAGE_EXIT_CODE);
  });

  it("returns the failure exit code for other errors", () => {
    const { ui, feedback } = createMemoryUi();

    const exitCode = reportFailure(new Error("boom"), ui, false);

    expect(feedback.text).to.equal(`✖ boom\n  ${STACK_TRACE_HINT}\n`);
    expect(exitCode).to.equal(FAILURE_EXIT_CODE);
  });
});
