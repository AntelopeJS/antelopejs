import fs from "node:fs";
import sinon from "sinon";
import { expect } from "chai";
import { Command, CommanderError } from "commander";
import { createMemoryUi } from "../../helpers/memory-ui";

import * as logging from "../../../src/logging";
import * as cliUi from "../../../src/core/cli/cli-ui";
import { runCLI } from "../../../src/core/cli/full-cli";
import * as versionCheck from "../../../src/core/cli/version-check";
import { CliError, runWithErrorBoundary } from "../../../src/core/cli/output";
import { CANCELLED_MESSAGE } from "../../../src/core/cli/cancellation";
import {
  CANCELLED_EXIT_CODE,
  FAILURE_EXIT_CODE,
  SUCCESS_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../../src/core/cli/exit-codes";

describe("runCLI behavior", () => {
  const originalArgv = process.argv.slice();

  afterEach(() => {
    process.argv = originalArgv.slice();
    process.exitCode = undefined;
    sinon.restore();
  });

  function stubCommon() {
    sinon
      .stub(fs, "readFileSync")
      .returns(JSON.stringify({ version: "0.0.0" }));
    sinon.stub(logging, "setupAntelopeProjectLogging");
    sinon.stub(versionCheck, "startUpdateCheck").returns(undefined);
    const parseStub = sinon.stub(Command.prototype, "parseAsync").resolves();
    const getOptionStub = sinon
      .stub(Command.prototype, "getOptionValue")
      .returns(undefined);
    sinon.stub(cliUi, "displayBanner");
    return { getOptionStub, parseStub };
  }

  it("displays banner when no args are provided", async () => {
    process.argv = ["node", "ajs"];
    stubCommon();

    await runCLI();

    expect((cliUi.displayBanner as sinon.SinonStub).calledOnce).to.equal(true);
  });

  it("adds channel filters when verbose is set", async () => {
    process.argv = ["node", "ajs", "--verbose", "core"];
    const { getOptionStub } = stubCommon();
    getOptionStub.returns(["core", "cli"]);

    const addFilterStub = sinon.stub(logging, "addChannelFilter");

    await runCLI();

    expect(addFilterStub.calledWith("core", 0)).to.equal(true);
    expect(addFilterStub.calledWith("cli", 0)).to.equal(true);
  });

  it("reports an available update after the command and cancels the check", async () => {
    process.argv = ["node", "ajs", "config", "show"];
    const { parseStub } = stubCommon();
    const cancel = sinon.stub();
    const check = { latestVersion: "1.0.0", cancel };
    (versionCheck.startUpdateCheck as sinon.SinonStub).returns(check);
    const reportStub = sinon.stub(versionCheck, "reportAvailableUpdate");

    await runCLI();

    expect(reportStub.calledOnceWithExactly("0.0.0", check as any)).to.equal(
      true,
    );
    expect(reportStub.calledAfter(parseStub)).to.equal(true);
    expect(cancel.calledAfter(reportStub)).to.equal(true);
  });

  it("cancels the update check when the command fails", async () => {
    process.argv = ["node", "ajs", "config", "show"];
    stubCommon();
    const cancel = sinon.stub();
    (versionCheck.startUpdateCheck as sinon.SinonStub).returns({ cancel });
    (Command.prototype.parseAsync as sinon.SinonStub).rejects(
      new Error("boom"),
    );
    const reportStub = sinon.stub(versionCheck, "reportAvailableUpdate");

    let thrown: unknown;
    try {
      await runCLI();
    } catch (err) {
      thrown = err;
    }

    expect((thrown as Error).message).to.equal("boom");
    expect(reportStub.called).to.equal(false);
    expect(cancel.calledOnce).to.equal(true);
  });

  it("reports a cancelled prompt with the cancelled exit code", async () => {
    process.argv = ["node", "ajs", "project", "init", "demo"];
    stubCommon();
    const cancel = sinon.stub();
    (versionCheck.startUpdateCheck as sinon.SinonStub).returns({ cancel });
    (Command.prototype.parseAsync as sinon.SinonStub).rejects({
      name: "ExitPromptError",
    });
    const exitStub = sinon.stub(process, "exit");
    const errorStub = sinon.stub(console, "error");
    const { ui, feedback } = createMemoryUi();

    await runWithErrorBoundary(runCLI, { ui });

    expect(exitStub.called).to.equal(false);
    expect(errorStub.calledOnceWith(CANCELLED_MESSAGE)).to.equal(true);
    expect(feedback.text).to.equal("");
    expect(process.exitCode).to.equal(CANCELLED_EXIT_CODE);
    expect(cancel.calledOnce).to.equal(true);
  });

  it("reports a command error once with its own exit code", async () => {
    process.argv = ["node", "ajs", "project", "build", "-e", "staging"];
    stubCommon();
    (Command.prototype.parseAsync as sinon.SinonStub).rejects(
      new CliError({
        title: "Unknown environment 'staging'",
        reason: "Known environments: default",
        exitCode: USAGE_EXIT_CODE,
      }),
    );
    const { ui, result, feedback } = createMemoryUi();

    await runWithErrorBoundary(runCLI, { ui, verbose: false });

    expect(feedback.text).to.equal(
      "✖ Unknown environment 'staging'\n  Known environments: default\n",
    );
    expect(result.text).to.equal("");
    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
  });

  it("reports an unexpected failure without its stack trace", async () => {
    process.argv = ["node", "ajs", "config", "show"];
    stubCommon();
    (Command.prototype.parseAsync as sinon.SinonStub).rejects(
      new Error("boom"),
    );
    const { ui, feedback } = createMemoryUi();

    await runWithErrorBoundary(runCLI, { ui, verbose: false });

    expect(feedback.text).to.equal(
      "✖ boom\n  Run with --verbose for the full trace.\n",
    );
    expect(process.exitCode).to.equal(FAILURE_EXIT_CODE);
  });

  it("keeps the usage exit code when commander prints help after an incomplete command", async () => {
    process.argv = ["node", "ajs", "project"];
    stubCommon();
    (Command.prototype.parseAsync as sinon.SinonStub).rejects(
      new CommanderError(1, "commander.help", "(outputHelp)"),
    );
    const { ui, feedback } = createMemoryUi();

    await runWithErrorBoundary(runCLI, { ui });

    expect(feedback.text).to.equal("");
    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
  });

  it("keeps a successful exit code when commander exits after help", async () => {
    process.argv = ["node", "ajs", "--help"];
    stubCommon();
    (Command.prototype.parseAsync as sinon.SinonStub).rejects(
      new CommanderError(0, "commander.helpDisplayed", "(outputHelp)"),
    );
    const { ui, feedback } = createMemoryUi();

    await runWithErrorBoundary(runCLI, { ui });

    expect(feedback.text).to.equal("");
    expect(process.exitCode).to.equal(SUCCESS_EXIT_CODE);
  });
});

describe("runCLI usage errors", () => {
  const originalArgv = process.argv.slice();

  afterEach(() => {
    process.argv = originalArgv.slice();
    process.exitCode = undefined;
    sinon.restore();
  });

  async function runUsage(args: string[]) {
    process.argv = ["node", "ajs", ...args];
    sinon.stub(logging, "setupAntelopeProjectLogging");
    sinon.stub(versionCheck, "startUpdateCheck").returns(undefined);
    const stderrStub = sinon.stub(process.stderr, "write").returns(true);
    const { ui, result, feedback } = createMemoryUi();
    try {
      await runWithErrorBoundary(runCLI, { ui, verbose: false });
    } finally {
      stderrStub.restore();
    }
    return { result, feedback, commanderOutput: stderrStub };
  }

  it("formats an unknown command with the suggestion and a help hint", async () => {
    const { result, feedback, commanderOutput } = await runUsage([
      "projet",
      "init",
      "demo",
    ]);

    expect(feedback.text).to.equal(
      [
        "✖ Unknown command 'projet'",
        "  Usage: ajs [options] [command]",
        "  → Did you mean project?",
        "  → Run ajs --help for usage",
        "",
      ].join("\n"),
    );
    expect(result.text).to.equal("");
    expect(commanderOutput.called).to.equal(false);
    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
  });

  it("formats a missing argument with the usage of the subcommand", async () => {
    const { feedback } = await runUsage(["config", "set", "git"]);

    expect(feedback.text).to.equal(
      [
        "✖ Missing required argument 'value'",
        "  Usage: ajs config set [options] <key> <value>",
        "  → Run ajs config set --help for usage",
        "",
      ].join("\n"),
    );
    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
  });

  it("formats an unknown option of a nested command", async () => {
    const { feedback } = await runUsage(["project", "modules", "--bogus"]);

    expect(feedback.text.split("\n")[0]).to.equal("✖ Unknown option '--bogus'");
    expect(feedback.text).to.contain(
      "→ Run ajs project modules --help for usage",
    );
    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
  });
});
