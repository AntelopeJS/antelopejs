import fs from "node:fs";
import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";
import { Command } from "commander";
const Module = require("node:module");

import * as logging from "../../../src/logging";
import * as cliUi from "../../../src/core/cli/cli-ui";
import * as fullCli from "../../../src/core/cli/full-cli";
import * as versionCheck from "../../../src/core/cli/version-check";
import { CANCELLED_MESSAGE } from "../../../src/core/cli/cancellation";
import { CANCELLED_EXIT_CODE } from "../../../src/core/cli/exit-codes";
import { FORCED_EXIT_GRACE_MS } from "../../../src/core/cli/failure-exit";

describe("CLI main guard", () => {
  const cliPath = require.resolve("../../../src/core/cli/index");

  function stubRunCliDeps() {
    const originalReadFileSync = fs.readFileSync;
    const packageJsonPath = path.join(
      path.dirname(cliPath),
      "../../../package.json",
    );
    sinon.stub(fs, "readFileSync").callsFake((...args: any[]) => {
      const target = args[0];
      if (typeof target === "string" && target === packageJsonPath) {
        return JSON.stringify({ version: "0.0.0" });
      }
      return (originalReadFileSync as any)(...args);
    });
    sinon.stub(logging, "setupAntelopeProjectLogging");
    sinon.stub(versionCheck, "startUpdateCheck").returns(undefined);
    sinon.stub(cliUi, "displayBanner");
    sinon.stub(Command.prototype, "getOptionValue").returns(undefined);
  }

  function loadCliAsMain() {
    delete require.cache[cliPath];
    delete Module._cache[cliPath];
    const originalMain = require.main;
    (Module as any)._load(cliPath, null, true);
    return () => {
      require.main = originalMain;
      delete Module._cache[cliPath];
    };
  }

  afterEach(() => {
    sinon.restore();
  });

  it("does not register its own SIGINT listener in module scope", () => {
    // Pre-load transitive dependencies that register SIGINT handlers (e.g. proper-lockfile via signal-exit)
    delete require.cache[cliPath];
    require(cliPath);
    const baselineCount = process.listenerCount("SIGINT");

    // Re-require the CLI module — should not add any additional listeners
    delete require.cache[cliPath];
    require(cliPath);
    expect(process.listenerCount("SIGINT")).to.equal(baselineCount);
  });

  it("reports a cancelled prompt and exits with the cancelled code", async () => {
    stubRunCliDeps();
    const previousExitCode = process.exitCode;
    sinon
      .stub(Command.prototype, "parseAsync")
      .rejects({ name: "ExitPromptError" });
    const exitStub = sinon.stub(process, "exit");
    const errorStub = sinon.stub(console, "error");
    const clock = sinon.useFakeTimers({ shouldAdvanceTime: true });
    const originalListeners = process.listeners("SIGINT");
    process.removeAllListeners("SIGINT");
    const restoreMain = loadCliAsMain();
    try {
      await clock.tickAsync(FORCED_EXIT_GRACE_MS);
      expect(errorStub.calledWith(CANCELLED_MESSAGE)).to.equal(true);
      expect(exitStub.calledWith(CANCELLED_EXIT_CODE)).to.equal(true);
    } finally {
      clock.restore();
      restoreMain();
      process.removeAllListeners("SIGINT");
      for (const listener of originalListeners) {
        process.on("SIGINT", listener);
      }
      exitStub.restore();
      errorStub.restore();
      process.exitCode = previousExitCode;
    }
  });

  it("exits with the cancelled code when a prompt outside the commands is cancelled", async () => {
    stubRunCliDeps();
    const previousExitCode = process.exitCode;
    sinon.stub(fullCli, "runCLI").rejects({ name: "ExitPromptError" });
    const exitStub = sinon.stub(process, "exit");
    const errorStub = sinon.stub(console, "error");
    const originalListeners = process.listeners("SIGINT");
    process.removeAllListeners("SIGINT");
    const restoreMain = loadCliAsMain();
    try {
      await new Promise((resolve) => setImmediate(resolve));
      expect(errorStub.calledWith(CANCELLED_MESSAGE)).to.equal(true);
      expect(exitStub.calledOnceWith(CANCELLED_EXIT_CODE)).to.equal(true);
    } finally {
      restoreMain();
      process.removeAllListeners("SIGINT");
      for (const listener of originalListeners) {
        process.on("SIGINT", listener);
      }
      exitStub.restore();
      errorStub.restore();
      process.exitCode = previousExitCode;
    }
  });

  it("forces the process out when a command reported a failure", async () => {
    stubRunCliDeps();
    const previousExitCode = process.exitCode;
    sinon.stub(Command.prototype, "parseAsync").callsFake(async () => {
      process.exitCode = 1;
      return new Command();
    });
    const exitStub = sinon.stub(process, "exit");
    const clock = sinon.useFakeTimers({ shouldAdvanceTime: true });
    const originalListeners = process.listeners("SIGINT");
    process.removeAllListeners("SIGINT");
    const restoreMain = loadCliAsMain();
    try {
      await clock.tickAsync(FORCED_EXIT_GRACE_MS);
      expect(exitStub.calledWith(1)).to.equal(true);
    } finally {
      clock.restore();
      restoreMain();
      process.removeAllListeners("SIGINT");
      for (const listener of originalListeners) {
        process.on("SIGINT", listener);
      }
      exitStub.restore();
      process.exitCode = previousExitCode;
    }
  });

  it("logs and exits on errors in main guard", async () => {
    stubRunCliDeps();
    sinon.stub(Command.prototype, "parseAsync").rejects(new Error("boom"));
    const exitStub = sinon.stub(process, "exit");
    const errorStub = sinon.stub(console, "error");
    const originalListeners = process.listeners("SIGINT");
    process.removeAllListeners("SIGINT");
    const restoreMain = loadCliAsMain();
    try {
      await new Promise((resolve) => setImmediate(resolve));
      expect(errorStub.called).to.equal(true);
      expect(exitStub.calledWith(1)).to.equal(true);
    } finally {
      restoreMain();
      process.removeAllListeners("SIGINT");
      for (const listener of originalListeners) {
        process.on("SIGINT", listener);
      }
      exitStub.restore();
      errorStub.restore();
    }
  });
});
