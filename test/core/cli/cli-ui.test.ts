import { expect } from "chai";
import * as sinon from "sinon";

import {
  consoleOutput,
  displayBanner,
  displayBox,
  error,
  header,
  info,
  Spinner,
  success,
  warning,
} from "../../../src/core/cli/cli-ui";

const SPINNER_TICK_MS = 200;

interface ConsoleStubs {
  log: sinon.SinonStub;
  error: sinon.SinonStub;
}

interface StreamStubs {
  stdout: sinon.SinonStub;
  stderr: sinon.SinonStub;
}

function stubConsole(): ConsoleStubs {
  return {
    log: sinon.stub(console, "log"),
    error: sinon.stub(console, "error"),
  };
}

function stubStreams(): StreamStubs {
  return {
    stdout: sinon.stub(process.stdout, "write"),
    stderr: sinon.stub(process.stderr, "write"),
  };
}

function setTerminal(isTerminal: boolean): void {
  (process.stdout as any).isTTY = isTerminal;
  (process.stderr as any).isTTY = isTerminal;
}

function firstArgument(stub: sinon.SinonStub): string {
  return String(stub.firstCall.args[0]);
}

describe("CLI UI", () => {
  const originalStdoutIsTTY = process.stdout.isTTY;
  const originalStderrIsTTY = process.stderr.isTTY;

  afterEach(() => {
    sinon.restore();
    (process.stdout as any).isTTY = originalStdoutIsTTY;
    (process.stderr as any).isTTY = originalStderrIsTTY;
  });

  describe("Spinner", () => {
    it("writes nothing to stdout in non-terminal mode", async () => {
      setTerminal(false);
      const streams = stubStreams();
      const consoleStubs = stubConsole();

      const spinner = new Spinner("Running");
      await spinner.start();
      spinner.log(process.stderr, "step");
      await spinner.succeed("done");
      sinon.restore();

      expect(streams.stdout.called).to.equal(false);
      expect(streams.stderr.calledWith("step\n")).to.equal(true);
      expect(consoleStubs.log.called).to.equal(false);
      expect(firstArgument(consoleStubs.error)).to.contain("done");
    });

    it("renders frames and clears its line on stderr in terminal mode", async () => {
      setTerminal(true);
      const streams = stubStreams();
      const clock = sinon.useFakeTimers();

      try {
        const spinner = new Spinner("Start");
        await spinner.start();
        spinner.update("Updated");
        clock.tick(SPINNER_TICK_MS);
        await spinner.stop();
      } finally {
        clock.restore();
        sinon.restore();
      }

      expect(streams.stdout.called).to.equal(false);
      expect(firstArgument(streams.stderr)).to.contain("Updated");
      expect(streams.stderr.calledWith("\r\x1b[K")).to.equal(true);
    });

    it("keeps the spinner on stderr when logging a message to stdout", async () => {
      setTerminal(true);
      const streams = stubStreams();
      const clock = sinon.useFakeTimers();

      try {
        const spinner = new Spinner("Working");
        await spinner.start();
        spinner.log(process.stdout, "result");
        await spinner.stop();
      } finally {
        clock.restore();
        sinon.restore();
      }

      expect(streams.stdout.calledOnceWith("result\n")).to.equal(true);
      expect(streams.stderr.calledWith("\r\x1b[K")).to.equal(true);
      expect(streams.stderr.calledWithMatch("Working")).to.equal(true);
    });

    it("reports every final status on stderr", async () => {
      setTerminal(false);
      stubStreams();
      const consoleStubs = stubConsole();
      const statuses = ["succeed", "fail", "info", "warn"] as const;

      for (const status of statuses) {
        const spinner = new Spinner(status);
        await spinner.start();
        await spinner[status]();
      }
      sinon.restore();

      expect(consoleStubs.log.called).to.equal(false);
      expect(consoleStubs.error.callCount).to.equal(statuses.length);
    });
  });

  describe("Display", () => {
    it("writes errors, warnings and info to stderr", () => {
      const consoleStubs = stubConsole();

      error("Failed");
      warning("Careful");
      info("Note");

      expect(consoleStubs.log.called).to.equal(false);
      expect(consoleStubs.error.callCount).to.equal(3);
      expect(consoleStubs.error.getCall(0).args[0]).to.contain("Failed");
      expect(consoleStubs.error.getCall(1).args[0]).to.contain("Careful");
      expect(consoleStubs.error.getCall(2).args[0]).to.contain("Note");
    });

    it("writes success results to stdout", () => {
      const consoleStubs = stubConsole();

      success("Done");

      expect(consoleStubs.error.called).to.equal(false);
      expect(firstArgument(consoleStubs.log)).to.contain("Done");
    });

    it("handles Error objects in error and warning", () => {
      const consoleStubs = stubConsole();
      const err = new Error("test-error");

      error(err);
      warning(err);

      expect(consoleStubs.log.called).to.equal(false);
      expect(consoleStubs.error.getCall(0).args[0]).to.contain("test-error");
      expect(consoleStubs.error.getCall(1).args[0]).to.contain("test-error");
    });

    it("routes the command output adapter to stderr", () => {
      const consoleStubs = stubConsole();

      consoleOutput.info("Running");
      consoleOutput.error("Broken");

      expect(consoleStubs.log.called).to.equal(false);
      expect(consoleStubs.error.getCall(0).args[0]).to.contain("Running");
      expect(consoleStubs.error.getCall(1).args[0]).to.contain("Broken");
    });

    it("writes the banner to stderr", () => {
      const consoleStubs = stubConsole();

      displayBanner("AntelopeJS");

      expect(consoleStubs.log.called).to.equal(false);
      expect(consoleStubs.error.calledOnce).to.equal(true);
    });

    it("writes boxes and headers to stdout", async () => {
      const consoleStubs = stubConsole();

      await displayBox("Hello", "Title");
      header("Header");

      expect(consoleStubs.error.called).to.equal(false);
      expect(consoleStubs.log.called).to.equal(true);
    });
  });
});
