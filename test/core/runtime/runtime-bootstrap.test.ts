import { ModuleContextInvalidatedError } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import { expect } from "chai";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import EventEmitter from "node:events";
import sinon from "sinon";

import { ConfigLoader } from "../../../src/core/config";
import * as bootstrap from "../../../src/core/runtime";
import { ShutdownManager } from "../../../src/core/runtime";
import * as logging from "../../../src/logging";

type ProcessEventName = "uncaughtException" | "unhandledRejection" | "warning";

type ProcessListenerSnapshot = Record<
  ProcessEventName,
  ((...args: any[]) => void)[]
>;

function snapshotProcessListeners(): ProcessListenerSnapshot {
  return {
    uncaughtException: process.listeners("uncaughtException"),
    unhandledRejection: process.listeners("unhandledRejection"),
    warning: process.listeners("warning"),
  };
}

function restoreProcessListeners(snapshot: ProcessListenerSnapshot): void {
  process.removeAllListeners("uncaughtException");
  process.removeAllListeners("unhandledRejection");
  process.removeAllListeners("warning");

  for (const listener of snapshot.uncaughtException) {
    process.on("uncaughtException", listener);
  }
  for (const listener of snapshot.unhandledRejection) {
    process.on("unhandledRejection", listener);
  }
  for (const listener of snapshot.warning) {
    process.on("warning", listener);
  }
}

describe("runtime runtime-bootstrap", () => {
  before(() => {
    bootstrap.setupProcessHandlers();
  });

  afterEach(() => {
    sinon.restore();
  });

  it("registers process handlers once and handles all branches", () => {
    const result = spawnSync(
      process.execPath,
      [
        "-r",
        "ts-node/register",
        "-e",
        `
          const { setupProcessHandlers } = require(process.argv[1]);
          const { Logging } = require("@antelopejs/interface-core/logging");
          const exits = [];
          let logged = 0;
          process.exit = code => exits.push(code);
          Logging.Error = () => { logged += 1; };
          const warnings = process.listenerCount("warning");
          setupProcessHandlers();
          const uncaughtOnce = process.listenerCount("uncaughtException");
          const rejectionOnce = process.listenerCount("unhandledRejection");
          setupProcessHandlers();
          const uncaught = process.listeners("uncaughtException");
          const rejection = process.listeners("unhandledRejection");
          uncaught.at(-1)({ message: "boom-no-stack" });
          uncaught.at(-1)(new Error("boom-with-stack"));
          rejection.at(-1)(new AggregateError([new Error("inner-a"), "inner-b"], "agg"));
          rejection.at(-1)("plain rejection");
          console.log(JSON.stringify({
            sameUncaught: uncaught.length === uncaughtOnce,
            sameRejection: rejection.length === rejectionOnce,
            warnings: process.listenerCount("warning") - warnings,
            exits,
            logged,
          }));
        `,
        require.resolve("../../../src/core/runtime"),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "true" },
        timeout: 20000,
      },
    );
    expect(result.status, result.stderr).to.equal(0);
    expect(JSON.parse(result.stdout)).to.deep.equal({
      sameUncaught: true,
      sameRejection: true,
      warnings: 0,
      exits: [1, 1, 1, 1],
      logged: 4,
    });
  });

  it("leaves process warnings to Node.js on stderr instead of logging them as output", () => {
    const originalListeners = snapshotProcessListeners();

    try {
      bootstrap.setupProcessHandlers();

      expect(process.listeners("warning")).to.deep.equal(
        originalListeners.warning,
      );
    } finally {
      restoreProcessListeners(originalListeners);
    }
  });

  it("keeps the process running when work of a destroyed module generation fails during hot reload", () => {
    const originalListeners = snapshotProcessListeners();
    const shutdownManager = new ShutdownManager();
    const shutdownStub = sinon.stub(shutdownManager, "shutdown").resolves();
    sinon.stub(Logging, "Error");
    const orphaned = new ModuleContextInvalidatedError("dms");

    try {
      bootstrap.setupProcessHandlers(shutdownManager);
      const withdraw = bootstrap.tolerateInvalidatedModuleWork();
      const current = snapshotProcessListeners();
      const uncaught = current.uncaughtException.at(-1);
      const rejection = current.unhandledRejection.at(-1);
      assert.ok(uncaught);
      assert.ok(rejection);

      uncaught(orphaned);
      rejection(orphaned);
      expect(shutdownStub.called).to.equal(false);

      rejection(new Error("unrelated"));
      expect(shutdownStub.calledOnceWith(1)).to.equal(true);

      withdraw();
      rejection(orphaned);
      expect(shutdownStub.calledTwice).to.equal(true);
    } finally {
      bootstrap.releaseProcessShutdownManager(shutdownManager);
      restoreProcessListeners(originalListeners);
    }
  });

  it("calls shutdown manager on uncaughtException instead of process.exit", () => {
    const originalListeners = snapshotProcessListeners();
    const shutdownManager = new ShutdownManager();
    const shutdownStub = sinon.stub(shutdownManager, "shutdown").resolves();
    const exitStub = sinon.stub(process, "exit");

    try {
      bootstrap.setupProcessHandlers(shutdownManager);

      const current = snapshotProcessListeners();
      const uncaught =
        current.uncaughtException[current.uncaughtException.length - 1];
      uncaught(new Error("boom"));

      expect(shutdownStub.calledOnceWith(1)).to.equal(true);
      expect(exitStub.called).to.equal(false);
    } finally {
      restoreProcessListeners(originalListeners);
      exitStub.restore();
    }
  });

  it("restores the previous process shutdown manager on release", () => {
    const originalListeners = snapshotProcessListeners();
    const first = new ShutdownManager();
    const second = new ShutdownManager();
    const firstShutdown = sinon.stub(first, "shutdown").resolves();
    const secondShutdown = sinon.stub(second, "shutdown").resolves();
    const exitStub = sinon.stub(process, "exit");

    try {
      bootstrap.setupProcessHandlers(first);
      bootstrap.setupProcessHandlers(second);
      bootstrap.releaseProcessShutdownManager(second);

      const current = snapshotProcessListeners();
      const uncaught =
        current.uncaughtException[current.uncaughtException.length - 1];
      uncaught(new Error("boom"));

      expect(firstShutdown.calledOnceWith(1)).to.equal(true);
      expect(secondShutdown.called).to.equal(false);
      expect(exitStub.called).to.equal(false);
      bootstrap.releaseProcessShutdownManager(first);
    } finally {
      restoreProcessListeners(originalListeners);
      exitStub.restore();
    }
  });

  it("allows late wiring of shutdown manager after handlers are registered", () => {
    const originalListeners = snapshotProcessListeners();

    const exitStub = sinon.stub(process, "exit");
    const shutdownManager = new ShutdownManager();
    const shutdownStub = sinon.stub(shutdownManager, "shutdown").resolves();

    try {
      bootstrap.setupProcessHandlers();
      bootstrap.setupProcessHandlers(shutdownManager);

      const current = snapshotProcessListeners();
      const uncaught =
        current.uncaughtException[current.uncaughtException.length - 1];
      uncaught(new Error("boom"));

      expect(shutdownStub.calledOnceWith(1)).to.equal(true);
      expect(exitStub.called).to.equal(false);
    } finally {
      restoreProcessListeners(originalListeners);
      exitStub.restore();
    }
  });

  it("raises and restores max listeners on success and failure", async () => {
    const originalMax = EventEmitter.defaultMaxListeners;

    EventEmitter.defaultMaxListeners = 7;
    const result = await bootstrap.withRaisedMaxListeners(async () => {
      expect(EventEmitter.defaultMaxListeners).to.equal(50);
      return "ok";
    });

    expect(result).to.equal("ok");
    expect(EventEmitter.defaultMaxListeners).to.equal(7);

    let thrown: unknown;
    try {
      await bootstrap.withRaisedMaxListeners(async () => {
        throw new Error("failure");
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect(EventEmitter.defaultMaxListeners).to.equal(7);

    EventEmitter.defaultMaxListeners = originalMax;
  });

  it("normalizes config and applies verbose channels when loading runtime config", async () => {
    const originalListeners = snapshotProcessListeners();

    sinon.stub(ConfigLoader.prototype, "load").resolves({
      name: "sample",
      cacheFolder: ".cache",
      // @ts-expect-error Missing modules exercises runtime normalization of partially loaded input (#228).
      modules: undefined,
      envOverrides: {},
      logging: { enabled: true },
    });

    const setupLoggingStub = sinon.stub(logging, "setupAntelopeProjectLogging");
    const addFilterStub = sinon.stub(logging, "addChannelFilter");

    try {
      const loaded = await bootstrap.loadProjectRuntimeConfig(
        "/project",
        "prod",
        {
          verbose: ["runtime", "loader"],
        },
      );

      expect(loaded.normalizedConfig.cacheFolder).to.equal("/project/.cache");
      expect(loaded.normalizedConfig.modules).to.deep.equal({});
      expect(setupLoggingStub.calledOnce).to.equal(true);
      expect(addFilterStub.calledWith("runtime", 0)).to.equal(true);
      expect(addFilterStub.calledWith("loader", 0)).to.equal(true);

      await bootstrap.loadProjectRuntimeConfig("/project", "prod", {});
      expect(addFilterStub.callCount).to.equal(2);
    } finally {
      restoreProcessListeners(originalListeners);
    }
  });

  it("normalizes absolute cache folders without modification", () => {
    const normalized = bootstrap.normalizeLoadedConfig(
      {
        name: "sample",
        cacheFolder: "/var/cache",
        // @ts-expect-error Missing modules exercises runtime normalization of partially loaded input (#228).
        modules: undefined,
        envOverrides: {},
      },
      "/project",
    );

    expect(normalized.cacheFolder).to.equal("/var/cache");
    expect(normalized.projectFolder).to.equal("/project");
  });

  it("logs an aggregate rejection once, its inner errors with it", () => {
    const originalListeners = snapshotProcessListeners();
    sinon.stub(process, "exit");
    const errorStub = sinon.stub(Logging, "Error");
    const aggregate = new AggregateError([new Error("inner-a")], "agg");

    try {
      bootstrap.setupProcessHandlers();
      const listeners = process.listeners("unhandledRejection");
      const rejection = listeners[listeners.length - 1];
      assert.ok(rejection);
      rejection(aggregate, Promise.resolve());

      expect(errorStub.args).to.deep.equal([
        ["Unhandled rejection:", aggregate],
      ]);
    } finally {
      restoreProcessListeners(originalListeners);
    }
  });
});
