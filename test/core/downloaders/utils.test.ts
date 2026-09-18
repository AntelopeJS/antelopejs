import os from "node:os";
import sinon from "sinon";
import { expect } from "chai";

import { ExecuteCMD } from "../../../src/core/cli/command";
import type { CommandResult } from "../../../src/core/downloaders/types";
import {
  expandHome,
  installFailureMessage,
  runInstallCommands,
} from "../../../src/core/downloaders/utils";

const silentLogger = { Debug: () => {} };

async function captureRejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
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

  it("names the module and the command in the failure message", () => {
    expect(installFailureMessage("demo", "pnpm install", "boom")).to.equal(
      "Failed to install dependencies for demo (command: pnpm install): boom",
    );
  });

  it("omits the reason when the command said nothing", () => {
    expect(installFailureMessage("demo", "pnpm install", "  ")).to.equal(
      "Failed to install dependencies for demo (command: pnpm install)",
    );
  });

  it("reports the failing command of a module", async () => {
    const failing: CommandResult = {
      stdout: "",
      stderr: "nope",
      code: 1,
    };
    const exec = sinon.stub().resolves(failing);

    const message = await captureRejection(
      runInstallCommands(exec, silentLogger, "demo", "/tmp", [
        "pnpm install",
        "pnpm build",
      ]),
    );

    expect(message).to.equal(
      "Failed to install dependencies for demo (command: pnpm install): nope",
    );
    expect(exec.callCount).to.equal(1);
  });

  it("reports a rejected command runner", async () => {
    const exec = sinon.stub().rejects(new Error("spawn failed"));

    const message = await captureRejection(
      runInstallCommands(exec, silentLogger, "demo", "/tmp", "pnpm install"),
    );

    expect(message).to.equal(
      "Failed to install dependencies for demo (command: pnpm install): spawn failed",
    );
  });

  it("fails instead of hanging when the install command reads stdin", async function () {
    this.timeout(10000);

    const message = await captureRejection(
      runInstallCommands(
        ExecuteCMD,
        silentLogger,
        "demo",
        process.cwd(),
        "sh -c 'read answer'",
      ),
    );

    expect(message).to.contain(
      "Failed to install dependencies for demo (command: sh -c 'read answer')",
    );
  });
});
