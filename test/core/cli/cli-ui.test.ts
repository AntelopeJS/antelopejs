import { expect } from "chai";
import * as sinon from "sinon";

import {
  consoleOutput,
  displayBanner,
  displayBox,
  error,
  header,
  info,
  keyValue,
  Spinner,
  success,
  warning,
} from "../../../src/core/cli/cli-ui";
import { stripAnsi } from "../../../src/core/cli/logging-utils";
import { getProcessUi, type MessageLevel } from "../../../src/core/cli/output";
import {
  captureOutput,
  captureOutputAsync,
} from "../../helpers/capture-output";

const SPINNER_TICK_MS = 200;

interface SpinnerStatus {
  method: "succeed" | "fail" | "info" | "warn";
  level: MessageLevel;
}

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

const { symbols } = getProcessUi();
const originalStdoutIsTTY = process.stdout.isTTY;
const originalStderrIsTTY = process.stderr.isTTY;

function restoreProcessStreams(): void {
  sinon.restore();
  (process.stdout as any).isTTY = originalStdoutIsTTY;
  (process.stderr as any).isTTY = originalStderrIsTTY;
}

describe("CLI UI spinner", () => {
  afterEach(restoreProcessStreams);

  it("writes nothing to stdout in non-terminal mode", async () => {
    setTerminal(false);

    const output = await captureOutputAsync(async () => {
      const spinner = new Spinner("Running");
      await spinner.start();
      spinner.log(process.stderr, "step");
      await spinner.succeed("done");
    });

    expect(output.stdout).to.equal("");
    expect(stripAnsi(output.stderr)).to.equal(
      `step\n${symbols.levels.success} done\n`,
    );
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

  it("reports every final status on stderr with its level symbol", async () => {
    setTerminal(false);
    const statuses: SpinnerStatus[] = [
      { method: "succeed", level: "success" },
      { method: "fail", level: "error" },
      { method: "info", level: "info" },
      { method: "warn", level: "warn" },
    ];

    const output = await captureOutputAsync(async () => {
      for (const { method } of statuses) {
        const spinner = new Spinner(method);
        await spinner.start();
        await spinner[method]();
      }
    });

    expect(output.stdout).to.equal("");
    expect(stripAnsi(output.stderr)).to.equal(
      statuses
        .map(({ method, level }) => `${symbols.levels[level]} ${method}\n`)
        .join(""),
    );
  });

  it("reports nothing when it was never started", async () => {
    const output = await captureOutputAsync(() =>
      new Spinner("Idle").succeed(),
    );

    expect(output.stderr).to.equal("");
  });
});

describe("CLI UI display", () => {
  afterEach(restoreProcessStreams);

  it("writes errors, warnings and info to stderr", () => {
    const output = captureOutput(() => {
      error("Failed");
      warning("Careful");
      info("Note");
    });

    expect(output.stdout).to.equal("");
    expect(stripAnsi(output.stderr)).to.equal(
      [
        `${symbols.levels.error} Failed`,
        `${symbols.levels.warn} Careful`,
        `${symbols.levels.info} Note`,
        "",
      ].join("\n"),
    );
  });

  it("writes success results to stdout", () => {
    const output = captureOutput(() => success("Done"));

    expect(output.stderr).to.equal("");
    expect(stripAnsi(output.stdout)).to.equal(
      `${symbols.levels.success} Done\n`,
    );
  });

  it("handles Error objects in error and warning", () => {
    const err = new Error("test-error");

    const output = captureOutput(() => {
      error(err);
      warning(err);
    });

    expect(output.stdout).to.equal("");
    expect(output.stderr.split("test-error")).to.have.lengthOf(3);
  });

  it("routes the command output adapter to stderr", () => {
    const output = captureOutput(() => {
      consoleOutput.info("Running");
      consoleOutput.error("Broken");
    });

    expect(output.stdout).to.equal("");
    expect(stripAnsi(output.stderr)).to.equal(
      `${symbols.levels.info} Running\n${symbols.levels.error} Broken\n`,
    );
  });

  it("writes the banner to stderr", () => {
    const consoleStubs = stubConsole();

    displayBanner("AntelopeJS");

    expect(consoleStubs.log.called).to.equal(false);
    expect(consoleStubs.error.calledOnce).to.equal(true);
  });

  it("writes boxes to stdout", async () => {
    const consoleStubs = stubConsole();

    await displayBox("Hello", "Title");

    expect(consoleStubs.error.called).to.equal(false);
    expect(consoleStubs.log.called).to.equal(true);
  });

  it("writes headers to stdout", () => {
    const output = captureOutput(() => header("Header"));

    expect(output.stderr).to.equal("");
    expect(stripAnsi(output.stdout)).to.contain(
      `Header\n${symbols.rule.repeat("Header".length)}\n`,
    );
  });

  it("formats a key and its value", () => {
    expect(stripAnsi(keyValue("Name", "acme"))).to.equal("Name: acme");
  });
});
