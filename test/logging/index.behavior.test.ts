import { RunWithResponsibleModule } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import { expect } from "chai";
import * as sinon from "sinon";
import {
  addChannelFilter,
  levelMap,
  setupAntelopeProjectLogging,
} from "../../src/logging";

interface CapturedOutput {
  stdout: string;
  stderr: string;
}

type StreamWrite = typeof process.stdout.write;

function collectInto(sink: string[]): StreamWrite {
  return ((chunk: unknown): boolean => {
    sink.push(String(chunk));
    return true;
  }) as unknown as StreamWrite;
}

function captureOutput(emit: () => void): CapturedOutput {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutStub = sinon
    .stub(process.stdout, "write")
    .callsFake(collectInto(stdout));
  const stderrStub = sinon
    .stub(process.stderr, "write")
    .callsFake(collectInto(stderr));

  try {
    emit();
  } finally {
    stdoutStub.restore();
    stderrStub.restore();
  }

  return { stdout: stdout.join(""), stderr: stderr.join("") };
}

describe("Logging Module", () => {
  afterEach(() => {
    sinon.restore();
    setupAntelopeProjectLogging({ enabled: false });
  });

  describe("levelMap", () => {
    it("should map level names to numbers", () => {
      expect(levelMap.trace).to.equal(0);
      expect(levelMap.debug).to.equal(10);
      expect(levelMap.info).to.equal(20);
      expect(levelMap.warn).to.equal(30);
      expect(levelMap.error).to.equal(40);
    });
  });

  describe("terminal output", () => {
    it("should write an INFO event to stdout when enabled", () => {
      setupAntelopeProjectLogging({ enabled: true });

      const output = captureOutput(() => Logging.Info("service ready"));

      expect(output.stdout).to.contain("[INFO]");
      expect(output.stdout).to.contain("service ready");
      expect(output.stderr).to.equal("");
    });

    it("should write nothing when disabled", () => {
      setupAntelopeProjectLogging({ enabled: false });

      const output = captureOutput(() => Logging.Info("never shown"));

      expect(output.stdout).to.equal("");
      expect(output.stderr).to.equal("");
    });

    it("should route ERROR to stderr", () => {
      setupAntelopeProjectLogging({ enabled: true });

      const output = captureOutput(() => Logging.Error("boom"));

      expect(output.stderr).to.contain("boom");
      expect(output.stdout).to.equal("");
    });
  });

  describe("channel filtering", () => {
    it("should drop a channel below its threshold", () => {
      setupAntelopeProjectLogging({
        enabled: true,
        channelFilter: { "quiet-probe": "error" },
      });
      const channel = new Logging.Channel("quiet-probe");

      const dropped = captureOutput(() => channel.Info("below threshold"));
      const kept = captureOutput(() => channel.Error("at threshold"));

      expect(dropped.stdout).to.equal("");
      expect(kept.stderr).to.contain("at threshold");
    });

    it("should lower a channel threshold through addChannelFilter", () => {
      setupAntelopeProjectLogging({ enabled: true });
      const channel = new Logging.Channel("verbose-probe");

      const before = captureOutput(() => channel.Debug("hidden"));
      addChannelFilter("verbose-probe", levelMap.trace);
      const after = captureOutput(() => channel.Debug("revealed"));

      expect(before.stdout).to.equal("");
      expect(after.stdout).to.contain("revealed");
    });
  });

  describe("module tracking", () => {
    it("should prefix the responsible module", () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: { enabled: true, includes: [], excludes: [] },
      });

      const output = captureOutput(() =>
        RunWithResponsibleModule("tagged-probe", () => Logging.Info("tagged")),
      );

      expect(output.stdout).to.contain("(tagged-probe)");
    });

    it("should not filter by module when tracking is disabled", () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: {
          enabled: false,
          includes: ["kept-probe"],
          excludes: ["core"],
        },
      });

      const output = captureOutput(() => Logging.Info("unfiltered"));

      expect(output.stdout).to.contain("unfiltered");
      expect(output.stdout).to.not.contain("(core)");
    });

    it("should attribute unmodule logs to the core module", () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: { enabled: true, includes: [], excludes: [] },
      });

      const output = captureOutput(() => Logging.Info("framework"));

      expect(output.stdout).to.contain("(core)");
    });

    it("should hide core logs when core is excluded", () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: { enabled: true, includes: [], excludes: ["core"] },
      });

      const output = captureOutput(() => Logging.Info("framework"));

      expect(output.stdout).to.equal("");
    });

    it("should hide core logs when includes omits core", () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: {
          enabled: true,
          includes: ["kept-probe"],
          excludes: [],
        },
      });

      const output = captureOutput(() => Logging.Info("framework"));

      expect(output.stdout).to.equal("");
    });

    it("should keep core logs when includes lists core", () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: {
          enabled: true,
          includes: ["kept-probe", "core"],
          excludes: [],
        },
      });

      const output = captureOutput(() => Logging.Info("framework"));

      expect(output.stdout).to.contain("framework");
      expect(output.stdout).to.contain("(core)");
    });

    it("should apply includes and excludes together", () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: {
          enabled: true,
          includes: ["kept-probe"],
          excludes: ["noisy-probe"],
        },
      });

      const kept = captureOutput(() =>
        RunWithResponsibleModule("kept-probe", () => Logging.Info("kept")),
      );
      const excluded = captureOutput(() =>
        RunWithResponsibleModule("noisy-probe", () => Logging.Info("noisy")),
      );
      const unlisted = captureOutput(() =>
        RunWithResponsibleModule("other-probe", () => Logging.Info("other")),
      );

      expect(kept.stdout).to.contain("kept");
      expect(excluded.stdout).to.equal("");
      expect(unlisted.stdout).to.equal("");
    });
  });
});
