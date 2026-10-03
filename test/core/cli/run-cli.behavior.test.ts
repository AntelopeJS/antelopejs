import fs from "node:fs";
import sinon from "sinon";
import { expect } from "chai";
import { Command, CommanderError } from "commander";

import * as logging from "../../../src/logging";
import * as cliUi from "../../../src/core/cli/cli-ui";
import { runCLI } from "../../../src/core/cli/full-cli";
import * as versionCheck from "../../../src/core/cli/version-check";
import { CliError } from "../../../src/core/cli/cli-error";
import { CANCELLED_MESSAGE } from "../../../src/core/cli/cancellation";
import {
  CANCELLED_EXIT_CODE,
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

    await runCLI();

    expect(exitStub.called).to.equal(false);
    expect(errorStub.calledOnceWith(CANCELLED_MESSAGE)).to.equal(true);
    expect(process.exitCode).to.equal(CANCELLED_EXIT_CODE);
    expect(cancel.calledOnce).to.equal(true);
  });

  it("reports a command error with its own exit code", async () => {
    process.argv = ["node", "ajs", "project", "build", "-e", "staging"];
    stubCommon();
    (Command.prototype.parseAsync as sinon.SinonStub).rejects(
      new CliError({
        title: "Unknown environment 'staging'",
        exitCode: USAGE_EXIT_CODE,
      }),
    );
    const errorStub = sinon.stub(cliUi, "error");

    await runCLI();

    expect(errorStub.calledOnceWith("Unknown environment 'staging'")).to.equal(
      true,
    );
    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
  });

  it("reports a usage error with the usage exit code", async () => {
    process.argv = ["node", "ajs", "project", "--bogus"];
    stubCommon();
    (Command.prototype.parseAsync as sinon.SinonStub).rejects(
      new CommanderError(1, "commander.unknownOption", "unknown option"),
    );

    await runCLI();

    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
  });

  it("keeps a successful exit code when commander exits after help", async () => {
    process.argv = ["node", "ajs", "--help"];
    stubCommon();
    (Command.prototype.parseAsync as sinon.SinonStub).rejects(
      new CommanderError(0, "commander.helpDisplayed", "(outputHelp)"),
    );

    await runCLI();

    expect(process.exitCode).to.equal(SUCCESS_EXIT_CODE);
  });
});
