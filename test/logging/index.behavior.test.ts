import { expect } from "chai";
import * as sinon from "sinon";
import { Logging } from "@antelopejs/interface-core/logging";
import { RunWithResponsibleModule } from "@antelopejs/interface-core";

import {
  addChannelFilter,
  levelMap,
  setLogAudience,
  setupAntelopeProjectLogging,
} from "../../src/logging";
import { getProcessTasks } from "../../src/core/cli/output/tasks";
import { CapturedOutput, captureOutput } from "../helpers/capture-output";

const ASYNC_CONTEXT_WARNING =
  "GetResponsibleModule called from within an async context";

function countOccurrences(output: string, needle: string): number {
  return output.split(needle).length - 1;
}

describe("Logging Module", () => {
  beforeEach(() => {
    setLogAudience("app");
  });

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

    it("should keep each level on its stream while a task is running", () => {
      setupAntelopeProjectLogging({ enabled: true });
      const tasks = getProcessTasks();
      const writeSpy = sinon.spy(tasks, "write");
      const task = tasks.start("Working");

      const output = captureOutput(() => {
        Logging.Error("boom");
        Logging.Info("ready");
      });
      task.dismiss();

      expect(writeSpy.firstCall.args[0]).to.equal(process.stderr);
      expect(writeSpy.secondCall.args[0]).to.equal(process.stdout);
      expect(output.stderr).to.contain("boom");
      expect(output.stdout).to.contain("ready");
      expect(output.stdout).to.not.contain("boom");
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

    /**
     * Asking for the responsible module from a timer callback makes
     * `GetResponsibleModule` warn through this very logger, and handling that
     * warning used to ask for the responsible module again: a single call
     * emitted the warning over and over, never emitted the line that asked
     * for it, and ran the process out of memory.
     */
    it("emits one line for a log raised from a timer callback", async () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: { enabled: true, includes: [], excludes: [] },
      });

      const output = await new Promise<CapturedOutput>((resolve) => {
        setTimeout(() => {
          resolve(captureOutput(() => Logging.Info("from a timer callback")));
        }, 1);
      });

      expect(countOccurrences(output.stdout, "from a timer callback")).to.equal(
        1,
      );
      expect(output.stdout).to.contain("(core)");
      expect(
        countOccurrences(output.stderr, ASYNC_CONTEXT_WARNING),
      ).to.be.at.most(1);
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

describe("Logging audience", () => {
  afterEach(() => {
    setupAntelopeProjectLogging({ enabled: false });
    setLogAudience("app");
  });

  it("writes every level on stderr for a CLI command", () => {
    setLogAudience("cli");
    setupAntelopeProjectLogging({ enabled: true });
    addChannelFilter("audience-probe", levelMap.trace);
    const probe = new Logging.Channel("audience-probe");

    const output = captureOutput(() => {
      probe.Trace("trace line");
      probe.Debug("debug line");
      probe.Info("info line");
      probe.Warn("warn line");
      probe.Error("error line");
    });

    expect(output.stdout).to.equal("");
    ["trace", "debug", "info", "warn", "error"].forEach((level) =>
      expect(output.stderr).to.contain(`${level} line`),
    );
  });

  it("writes the log lines of an application on stdout, errors on stderr", () => {
    setLogAudience("app");
    setupAntelopeProjectLogging({ enabled: true });

    const output = captureOutput(() => {
      Logging.Warn("warn line");
      Logging.Error("error line");
    });

    expect(output.stdout).to.contain("warn line");
    expect(output.stdout).to.not.contain("error line");
    expect(output.stderr).to.contain("error line");
  });
});
