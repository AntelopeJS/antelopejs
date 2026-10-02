import fs from "node:fs";
import sinon from "sinon";
import { expect } from "chai";
import { Command } from "commander";

import * as logging from "../../../src/logging";
import * as cliUi from "../../../src/core/cli/cli-ui";
import { runCLI } from "../../../src/core/cli/full-cli";
import * as versionCheck from "../../../src/core/cli/version-check";

describe("runCLI behavior", () => {
  const originalArgv = process.argv.slice();

  afterEach(() => {
    process.argv = originalArgv.slice();
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

  it("exits when ExitPromptError is thrown", async () => {
    process.argv = ["node", "ajs"];
    sinon
      .stub(fs, "readFileSync")
      .returns(JSON.stringify({ version: "0.0.0" }));
    sinon.stub(logging, "setupAntelopeProjectLogging");
    sinon.stub(versionCheck, "startUpdateCheck").returns(undefined);
    sinon.stub(cliUi, "displayBanner");
    sinon
      .stub(Command.prototype, "parseAsync")
      .rejects({ name: "ExitPromptError" });
    sinon.stub(Command.prototype, "getOptionValue").returns(undefined);

    const exitStub = sinon.stub(process, "exit");

    let thrown: unknown;
    try {
      await runCLI();
    } catch (err) {
      thrown = err;
    }

    expect(exitStub.calledWith(0)).to.equal(true);
    expect((thrown as any)?.name).to.equal("ExitPromptError");
  });
});
