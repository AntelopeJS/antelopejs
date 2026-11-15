import { ModuleContextInvalidatedError } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import { expect } from "chai";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import EventEmitter from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sinon from "sinon";

import { tsConfigFileModule as tsConfigFile } from "../../../src/core/config";
import { ShutdownManager } from "../../../src/core/runtime";
import * as logging from "../../../src/logging";

const CHILD_LIMIT_MS = 20000;
const ASSERTION_MARGIN_MS = 5000;

type ProcessEventName = "uncaughtException" | "unhandledRejection" | "warning";

type ProcessListenerSnapshot = Record<
  ProcessEventName,
  ((...args: any[]) => void)[]
>;

type ProcessHandler = ProcessListenerSnapshot[ProcessEventName][number];

interface BootstrapHandlers {
  uncaught: ProcessHandler;
  rejection: ProcessHandler;
}

/**
 * Loads a private copy of the runtime entry, bootstrap module included.
 *
 * The module remembers that it registered its process handlers, but a test
 * runner may wipe the process listeners behind its back: a mocha worker does
 * after each file it runs, and the next file of that worker then finds the
 * flag set and no handler attached. A private copy starts without the flag, so
 * the handlers it registers are always the ones under test.
 */
async function loadPrivateBootstrap() {
  const entryPath = require.resolve("../../../src/core/runtime");
  const bootstrapPath = require.resolve(
    path.join(path.dirname(entryPath), "runtime-bootstrap"),
  );
  const shared = [entryPath, bootstrapPath].map(
    (modulePath) => [modulePath, require.cache[modulePath]] as const,
  );
  for (const [modulePath] of shared) {
    delete require.cache[modulePath];
  }
  try {
    return await import("../../../src/core/runtime");
  } finally {
    for (const [modulePath, entry] of shared) {
      if (entry) {
        require.cache[modulePath] = entry;
      } else {
        delete require.cache[modulePath];
      }
    }
  }
}

let bootstrap: Awaited<ReturnType<typeof loadPrivateBootstrap>>;
let handlers: BootstrapHandlers;

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

function installedBy(register: () => void): BootstrapHandlers {
  const before = snapshotProcessListeners();
  register();
  const after = snapshotProcessListeners();
  const [uncaught] = after.uncaughtException.filter(
    (listener) => !before.uncaughtException.includes(listener),
  );
  const [rejection] = after.unhandledRejection.filter(
    (listener) => !before.unhandledRejection.includes(listener),
  );
  assert.ok(uncaught);
  assert.ok(rejection);
  return { uncaught, rejection };
}

{
  let registerRuntimeRuntimeBootstrap: (this: Mocha.Suite) => void;

  const checkRegistersProcessHandlersOnceAnd: (this: Mocha.Suite) => void =
    function () {
      it("registers process handlers once and handles all branches", function () {
        this.timeout(CHILD_LIMIT_MS + ASSERTION_MARGIN_MS);
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
            timeout: CHILD_LIMIT_MS,
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

          handlers.uncaught(orphaned);
          handlers.rejection(orphaned);
          expect(shutdownStub.called).to.equal(false);

          handlers.rejection(new Error("unrelated"));
          expect(shutdownStub.calledOnceWith(1)).to.equal(true);

          withdraw();
          handlers.rejection(orphaned);
          expect(shutdownStub.calledTwice).to.equal(true);
        } finally {
          bootstrap.releaseProcessShutdownManager(shutdownManager);
          restoreProcessListeners(originalListeners);
        }
      });

      it("shuts down on a thrown value that is not an Error, even while tolerating invalidated work", () => {
        const originalListeners = snapshotProcessListeners();
        const shutdownManager = new ShutdownManager();
        const shutdownStub = sinon.stub(shutdownManager, "shutdown").resolves();
        sinon.stub(Logging, "Error");
        const invalidatedCode = new ModuleContextInvalidatedError("dms").code;

        try {
          bootstrap.setupProcessHandlers(shutdownManager);
          const withdraw = bootstrap.tolerateInvalidatedModuleWork();

          handlers.uncaught("str");
          handlers.uncaught(null);
          handlers.uncaught({ code: invalidatedCode });
          expect(shutdownStub.callCount).to.equal(3);
          expect(shutdownStub.alwaysCalledWith(1)).to.equal(true);
          withdraw();
        } finally {
          bootstrap.releaseProcessShutdownManager(shutdownManager);
          restoreProcessListeners(originalListeners);
        }
      });
    };

  const checkCallsShutdownManagerOnUncaughtException: (
    this: Mocha.Suite,
  ) => void = function () {
    it("calls shutdown manager on uncaughtException instead of process.exit", () => {
      const originalListeners = snapshotProcessListeners();
      const shutdownManager = new ShutdownManager();
      const shutdownStub = sinon.stub(shutdownManager, "shutdown").resolves();
      const exitStub = sinon.stub(process, "exit");

      try {
        bootstrap.setupProcessHandlers(shutdownManager);

        handlers.uncaught(new Error("boom"));

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

        handlers.uncaught(new Error("boom"));

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

        handlers.uncaught(new Error("boom"));

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
  };

  const checkNormalizesConfigAndAppliesVerbose: (this: Mocha.Suite) => void =
    function () {
      it("normalizes config and applies verbose channels when loading runtime config", async () => {
        const originalListeners = snapshotProcessListeners();
        const projectFolder = await mkdtemp(
          path.join(os.tmpdir(), "bootstrap-config-"),
        );
        await writeFile(path.join(projectFolder, "antelope.config.ts"), "");

        sinon.stub(tsConfigFile, "loadTsConfigFile").resolves({
          name: "sample",
          cacheFolder: ".cache",
          envOverrides: {},
          logging: { enabled: true },
        });

        const setupLoggingStub = sinon.stub(
          logging,
          "setupAntelopeProjectLogging",
        );
        const addFilterStub = sinon.stub(logging, "addChannelFilter");

        try {
          const loaded = await bootstrap.loadProjectRuntimeConfig(
            projectFolder,
            "prod",
            {
              verbose: ["runtime", "loader"],
            },
          );

          expect(loaded.normalizedConfig.cacheFolder).to.equal(
            path.join(projectFolder, ".cache"),
          );
          expect(loaded.normalizedConfig.modules).to.deep.equal({});
          expect(setupLoggingStub.calledOnce).to.equal(true);
          expect(addFilterStub.calledWith("runtime", 0)).to.equal(true);
          expect(addFilterStub.calledWith("loader", 0)).to.equal(true);

          await bootstrap.loadProjectRuntimeConfig(projectFolder, "prod", {});
          expect(addFilterStub.callCount).to.equal(2);
        } finally {
          restoreProcessListeners(originalListeners);
          await rm(projectFolder, { recursive: true, force: true });
        }
      });

      it("normalizes absolute cache folders without modification and defaults a missing module map", () => {
        const normalized = bootstrap.normalizeLoadedConfig(
          {
            name: "sample",
            cacheFolder: "/var/cache",
            envOverrides: {},
          },
          "/project",
        );

        expect(normalized.cacheFolder).to.equal("/var/cache");
        expect(normalized.projectFolder).to.equal(path.resolve("/project"));
        expect(normalized.modules).to.deep.equal({});
      });

      it("logs an aggregate rejection once, its inner errors with it", () => {
        const originalListeners = snapshotProcessListeners();
        sinon.stub(process, "exit");
        const errorStub = sinon.stub(Logging, "Error");
        const aggregate = new AggregateError([new Error("inner-a")], "agg");

        try {
          bootstrap.setupProcessHandlers();
          handlers.rejection(aggregate, Promise.resolve());

          expect(errorStub.args).to.deep.equal([
            ["Unhandled rejection:", aggregate],
          ]);
        } finally {
          restoreProcessListeners(originalListeners);
        }
      });
    };

  registerRuntimeRuntimeBootstrap = () => {
    before(async () => {
      bootstrap = await loadPrivateBootstrap();
      handlers = installedBy(() => bootstrap.setupProcessHandlers());
    });

    after(() => {
      process.removeListener("uncaughtException", handlers.uncaught);
      process.removeListener("unhandledRejection", handlers.rejection);
    });

    afterEach(() => {
      sinon.restore();
    });

    describe("registers process handlers once and handles all branches", function () {
      checkRegistersProcessHandlersOnceAnd.call(this);
    });

    describe("calls shutdown manager on uncaughtException instead of process.exit", function () {
      checkCallsShutdownManagerOnUncaughtException.call(this);
    });

    describe("normalizes config and applies verbose channels when loading runtime config", function () {
      checkNormalizesConfigAndAppliesVerbose.call(this);
    });
  };

  describe("runtime runtime-bootstrap", function () {
    registerRuntimeRuntimeBootstrap.call(this);
  });
}
