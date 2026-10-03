import os from "node:os";
import sinon from "sinon";
import { expect } from "chai";

import { ExecError, ExecuteCMD } from "../../../src/core/cli/command";
import * as cliUi from "../../../src/core/cli/cli-ui";
import { CliError } from "../../../src/core/cli/output";
import { terminalDisplay } from "../../../src/core/cli/terminal-display";
import type { CommandResult } from "../../../src/core/downloaders/types";
import {
  expandHome,
  runInstallCommands,
} from "../../../src/core/downloaders/utils";

const silentLogger = { Debug: () => {} };

async function captureRejection(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (err) {
    expect(err).to.be.instanceOf(CliError);
    return err as CliError;
  }
  throw new Error("Expected the promise to reject");
}

describe("Downloader utils", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("expands leading tilde", () => {
    sinon.stub(os, "homedir").returns("/home/test");

    expect(expandHome("~")).to.equal("/home/test");
    expect(expandHome("~/work")).to.equal("/home/test/work");
  });

  it("expands mid-string tilde when prefix matches home", () => {
    sinon.stub(os, "homedir").returns("/home/test");

    expect(expandHome("/home/test/projects~sub")).to.equal("/home/test/sub");
  });

  it("expands mid-string tilde when prefix differs", () => {
    sinon.stub(os, "homedir").returns("/home/test");

    expect(expandHome("proj~backup")).to.equal("proj/home/testbackup");
  });

  it("returns input when no tilde exists", () => {
    sinon.stub(os, "homedir").returns("/home/test");

    expect(expandHome("/opt/project")).to.equal("/opt/project");
  });
});

describe("Install command execution", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("reports the failing command of a module with its exit code and output", async () => {
    const failing: CommandResult = {
      stdout: "",
      stderr: "nope",
      code: 1,
    };
    const exec = sinon.stub().resolves(failing);

    const failure = await captureRejection(
      runInstallCommands(exec, silentLogger, "demo", "/tmp", [
        "pnpm install",
        "pnpm build",
      ]),
    );

    expect(failure.problem.title).to.equal(
      "Failed to install dependencies for demo",
    );
    expect(failure.problem.reason).to.equal(
      "'pnpm install' exited with code 1.",
    );
    expect(failure.cause).to.be.instanceOf(ExecError);
    expect((failure.cause as ExecError).stderr).to.equal("nope");
    expect(exec.callCount).to.equal(1);
  });

  it("keeps the command failure a rejected runner reports", async () => {
    const execFailure = new ExecError({
      command: "pnpm install",
      stdout: "",
      stderr: "boom",
      code: 7,
    });
    const exec = sinon.stub().rejects(execFailure);

    const failure = await captureRejection(
      runInstallCommands(exec, silentLogger, "demo", "/tmp", "pnpm install"),
    );

    expect(failure.cause).to.equal(execFailure);
    expect(failure.problem.reason).to.equal(
      "'pnpm install' exited with code 7.",
    );
  });

  it("reports a runner that rejects with something else as a failed command", async () => {
    const exec = sinon.stub().rejects(new Error("spawn failed"));

    const failure = await captureRejection(
      runInstallCommands(exec, silentLogger, "demo", "/tmp", "pnpm install"),
    );

    expect((failure.cause as ExecError).stderr).to.equal("spawn failed");
    expect((failure.cause as ExecError).exitCode).to.equal(1);
  });

  it("reports the failed install once on the running spinner", async () => {
    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "isSpinnerActive").returns(true);
    const failStub = sinon.stub(terminalDisplay, "failSpinner").resolves();
    const errorStub = sinon.stub(cliUi, "error");
    const exec = sinon.stub().resolves({ stdout: "", stderr: "x", code: 2 });

    await captureRejection(
      runInstallCommands(exec, silentLogger, "demo", "/tmp", "pnpm install"),
    );

    expect(
      failStub.calledOnceWith("Install failed for demo (pnpm install, exit 2)"),
    ).to.equal(true);
    expect(errorStub.called).to.equal(false);
  });

  it("reports the failed install as an error line without a spinner", async () => {
    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "isSpinnerActive").returns(false);
    const failStub = sinon.stub(terminalDisplay, "failSpinner").resolves();
    const errorStub = sinon.stub(cliUi, "error");
    const exec = sinon.stub().rejects("not an error");

    const failure = await captureRejection(
      runInstallCommands(exec, silentLogger, "demo", "/tmp", "pnpm install"),
    );

    expect(
      errorStub.calledOnceWith(
        "Install failed for demo (pnpm install, exit 1)",
      ),
    ).to.equal(true);
    expect(failStub.called).to.equal(false);
    expect((failure.cause as ExecError).command).to.equal("pnpm install");
  });

  it("fails instead of hanging when the install command reads stdin", async function () {
    this.timeout(10000);

    const failure = await captureRejection(
      runInstallCommands(
        ExecuteCMD,
        silentLogger,
        "demo",
        process.cwd(),
        "sh -c 'read answer'",
      ),
    );

    expect(failure.problem.title).to.equal(
      "Failed to install dependencies for demo",
    );
    expect((failure.cause as ExecError).command).to.equal(
      "sh -c 'read answer'",
    );
  });
});
