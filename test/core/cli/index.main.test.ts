import { expect } from "chai";
import { Command } from "commander";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import sinon from "sinon";

import {
  FORCED_EXIT_GRACE_MS,
  fullCliModule as fullCli,
  versionCheckModule as versionCheck,
} from "../../../src/cli";
import {
  CANCELLED_EXIT_CODE,
  CANCELLED_MESSAGE,
  CancelledError,
  CliError,
  FAILURE_EXIT_CODE,
  getProcessUi,
  USAGE_EXIT_CODE,
} from "../../../src/core/output";
import * as logging from "../../../src/logging";

{
  let registerCLIMainGuard: (this: Mocha.Suite) => void;

  const initializeCliPath = () =>
    require.resolve("../../../src/core/cli/index");
  let cliPath: ReturnType<typeof initializeCliPath>;

  function stubRunCliDeps() {
    const packageJsonPath = path.join(
      path.dirname(cliPath),
      "../../../package.json",
    );
    sinon
      .stub(fs, "readFileSync")
      .callThrough()
      .withArgs(packageJsonPath)
      .returns(JSON.stringify({ version: "0.0.0" }));
    sinon.stub(logging, "setupAntelopeProjectLogging");
    sinon.stub(versionCheck, "startUpdateCheck").returns(undefined);
    sinon.stub(Command.prototype, "getOptionValue").returns(undefined);
  }

  function loadCliAsMain() {
    delete require.cache[cliPath];
    delete Module._cache[cliPath];
    const originalMain = require.main;
    Module._load(cliPath, null, true);
    return () => {
      require.main = originalMain;
      delete Module._cache[cliPath];
    };
  }

  const checkDoesNotRegisterItsOwn: (this: Mocha.Suite) => void = function () {
    it("does not register its own SIGINT listener in module scope", () => {
      delete require.cache[cliPath];
      require(cliPath);
      const listenersFromDependencies = process.listenerCount("SIGINT");

      delete require.cache[cliPath];
      require(cliPath);
      expect(process.listenerCount("SIGINT")).to.equal(
        listenersFromDependencies,
      );
    });

    it("reports a cancelled prompt and exits with the cancelled code", async () => {
      stubRunCliDeps();
      const previousExitCode = process.exitCode;
      sinon.stub(Command.prototype, "parseAsync").rejects(new CancelledError());
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
  };

  async function runMainUntilForcedExit(): Promise<sinon.SinonStub> {
    const previousExitCode = process.exitCode;
    const exitStub = sinon.stub(process, "exit");
    const clock = sinon.useFakeTimers({ shouldAdvanceTime: true });
    const originalListeners = process.listeners("SIGINT");
    process.removeAllListeners("SIGINT");
    const restoreMain = loadCliAsMain();
    try {
      await clock.tickAsync(FORCED_EXIT_GRACE_MS);
      return exitStub;
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
  }

  const checkExitsWithTheCancelledCode: (this: Mocha.Suite) => void =
    function () {
      it("exits with the cancelled code when a prompt outside the commands is cancelled", async () => {
        stubRunCliDeps();
        sinon.stub(fullCli, "runCLI").rejects(new CancelledError());
        const errorStub = sinon.stub(console, "error");

        const exitStub = await runMainUntilForcedExit();

        expect(errorStub.calledOnceWith(CANCELLED_MESSAGE)).to.equal(true);
        expect(exitStub.calledOnceWith(CANCELLED_EXIT_CODE)).to.equal(true);
      });

      it("reports a command error once and exits with its exit code", async () => {
        stubRunCliDeps();
        sinon.stub(Command.prototype, "parseAsync").rejects(
          new CliError({
            title: "Unknown environment 'staging'",
            exitCode: USAGE_EXIT_CODE,
          }),
        );
        const problemStub = sinon.stub(getProcessUi(), "problem");

        const exitStub = await runMainUntilForcedExit();

        expect(problemStub.calledOnce).to.equal(true);
        expect(problemStub.firstCall.args[0].title).to.equal(
          "Unknown environment 'staging'",
        );
        expect(exitStub.calledOnceWith(USAGE_EXIT_CODE)).to.equal(true);
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

      it("reports an unexpected error without its stack trace", async () => {
        stubRunCliDeps();
        sinon.stub(Command.prototype, "parseAsync").rejects(new Error("boom"));
        const problemStub = sinon.stub(getProcessUi(), "problem");
        const errorStub = sinon.stub(console, "error");

        const exitStub = await runMainUntilForcedExit();

        expect(problemStub.calledOnce).to.equal(true);
        expect(problemStub.firstCall.args[0]).to.deep.equal({
          title: "boom",
          details: ["Run with --verbose for the full trace."],
        });
        expect(errorStub.called).to.equal(false);
        expect(exitStub.calledOnceWith(FAILURE_EXIT_CODE)).to.equal(true);
      });

      it("shows the stack trace of an unexpected error with --verbose", async () => {
        stubRunCliDeps();
        const originalArgv = process.argv;
        process.argv = [...originalArgv, "--verbose"];
        sinon.stub(Command.prototype, "parseAsync").rejects(new Error("boom"));
        const problemStub = sinon.stub(getProcessUi(), "problem");

        try {
          await runMainUntilForcedExit();
        } finally {
          process.argv = originalArgv;
        }

        const details = problemStub.firstCall.args[0].details ?? [];
        expect(details[0]).to.equal("Error: boom");
        expect(details.some((line) => line.trim().startsWith("at "))).to.equal(
          true,
        );
      });
    };

  registerCLIMainGuard = () => {
    cliPath = initializeCliPath();

    afterEach(() => {
      sinon.restore();
    });

    describe("does not register its own SIGINT listener in module scope", function () {
      checkDoesNotRegisterItsOwn.call(this);
    });

    describe("exits with the cancelled code when a prompt outside the commands is cancelled", function () {
      checkExitsWithTheCancelledCode.call(this);
    });
  };

  describe("CLI main guard", function () {
    registerCLIMainGuard.call(this);
  });
}
