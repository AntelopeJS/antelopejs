import os from "node:os";
import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";
import Module from "node:module";
import fs from "node:fs/promises";
import * as runtimeInterface from "@antelopejs/interface-core/runtime";
import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";

import { ShutdownManager } from "../../../src/core/shutdown";
import * as processClaim from "../../../src/core/runtime/process-claim";
import { LaunchInterruptedError } from "../../../src/core/runtime/launch-interruption";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { ModuleManifest } from "../../../src/core/module-manifest";
import * as logging from "../../../src/logging";
import { runLaunchSequence } from "../../../src/core/runtime/launch-sequence";
import { EMBEDDED_RUNTIME_POLICY } from "../../../src/core/runtime/runtime-policy";
import type { ProjectPreparer } from "../../../src/core/runtime/runtime-types";

const STARTED_FLAG = "__ajsLaunchSequenceStarted";
const CONSTRUCTED_HOOK = "__ajsLaunchSequenceConstructed";

type LaunchGlobals = Record<string, unknown>;

async function writeLocalModule(
  folder: string,
  name: string,
  source: string,
): Promise<ModuleManifest> {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
  );
  await fs.writeFile(path.join(folder, "index.js"), source);
  const moduleSource: ModuleSourceLocal = {
    type: "local",
    path: folder,
    main: "index.js",
  };
  return ModuleManifest.create(folder, moduleSource, name);
}

async function launchInterruptedBy(
  shutdownManager: ShutdownManager,
  prepare: ProjectPreparer,
): Promise<unknown> {
  sinon.stub(processClaim, "createShutdownManager").returns(shutdownManager);
  try {
    await runLaunchSequence(
      prepare,
      os.tmpdir(),
      "test",
      {},
      EMBEDDED_RUNTIME_POLICY,
    );
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("runtime launch-sequence", () => {
  afterEach(() => {
    sinon.restore();
  });

  function stoppedAfterLogging(): ProjectPreparer {
    return async () => ({
      fs: new NodeFileSystem(),
      dev: true,
      loadContext: async () => ({}) as any,
      verify: () => Promise.reject(new Error("stop")),
      createEntries: async () => [],
    });
  }

  async function launchUntilVerify(
    policy?: typeof EMBEDDED_RUNTIME_POLICY,
  ): Promise<void> {
    await runLaunchSequence(
      stoppedAfterLogging(),
      os.tmpdir(),
      "test",
      {},
      policy,
    ).catch(() => undefined);
  }

  it("writes log lines for an application when it owns the logging", async () => {
    const audience = sinon.stub(logging, "setLogAudience");
    sinon.stub(logging, "setupAntelopeProjectLogging");

    await launchUntilVerify();

    expect(audience.calledOnceWithExactly("app")).to.equal(true);
  });

  it("leaves the log audience to an embedding host", async () => {
    const audience = sinon.stub(logging, "setLogAudience");

    await launchUntilVerify(EMBEDDED_RUNTIME_POLICY);

    expect(audience.called).to.equal(false);
  });

  it("releases module and registered runtime resources after startup fails", async () => {
    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-launch-failure-"),
    );
    const moduleFolder = path.join(projectFolder, "failing-module");
    const previousResolver = (Module as any)._resolveFilename;
    const shutdown = sinon.spy(ShutdownManager.prototype, "shutdown");

    try {
      await fs.mkdir(moduleFolder, { recursive: true });
      await fs.writeFile(
        path.join(moduleFolder, "package.json"),
        JSON.stringify({
          name: "failing-module",
          version: "1.0.0",
          main: "index.js",
        }),
      );
      await fs.writeFile(
        path.join(moduleFolder, "index.js"),
        `
const runtime = require("@antelopejs/interface-core/runtime");
exports.construct = () => runtime.RegisterDevServer("api", [{ port: 3000 }]);
exports.start = () => Promise.reject(new Error("startup failed"));
`,
      );
      const source: ModuleSourceLocal = {
        type: "local",
        path: moduleFolder,
        main: "index.js",
      };
      const manifest = await ModuleManifest.create(
        moduleFolder,
        source,
        "failing-module",
      );
      const nodeFileSystem = new NodeFileSystem();
      const prepare: ProjectPreparer = async () => ({
        fs: nodeFileSystem,
        dev: true,
        loadContext: async () => ({}) as any,
        verify: async () => undefined,
        createEntries: async () => [{ manifest, config: {} }],
      });

      let thrown: unknown;
      try {
        await runLaunchSequence(prepare, projectFolder, "test", {});
      } catch (error) {
        thrown = error;
      }

      const registryPath = path.join(
        projectFolder,
        runtimeInterface.DEV_REGISTRY_PATH,
      );
      expect(thrown).to.be.instanceOf(AggregateError);
      expect(shutdown.calledOnce).to.equal(true);
      expect(await nodeFileSystem.exists(registryPath)).to.equal(false);
      expect((Module as any)._resolveFilename).to.equal(previousResolver);
    } finally {
      (Module as any)._resolveFilename = previousResolver;
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});

describe("runtime launch-sequence interrupted by a shutdown", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("stops before checking the project once it is prepared", async () => {
    const shutdownManager = new ShutdownManager();
    const verify = sinon.stub().resolves();

    const thrown = await launchInterruptedBy(shutdownManager, async () => {
      void shutdownManager.shutdown();
      return {
        fs: new NodeFileSystem(),
        dev: true,
        loadContext: async () => ({}) as any,
        verify,
        createEntries: async () => [],
      };
    });

    expect(thrown).to.be.instanceOf(LaunchInterruptedError);
    expect(verify.called).to.equal(false);
  });

  it("cancels the check of the project and loads no module", async () => {
    const shutdownManager = new ShutdownManager();
    const createEntries = sinon.stub().resolves([]);
    let checkSignal: AbortSignal | undefined;

    const thrown = await launchInterruptedBy(shutdownManager, async () => ({
      fs: new NodeFileSystem(),
      dev: true,
      loadContext: async () => ({}) as any,
      verify: async (stopping) => {
        checkSignal = stopping;
        void shutdownManager.shutdown();
      },
      createEntries,
    }));

    expect(thrown).to.be.instanceOf(LaunchInterruptedError);
    expect(checkSignal?.aborted).to.equal(true);
    expect(createEntries.called).to.equal(false);
  });

  it("starts none of the modules it constructed", async () => {
    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-launch-interrupted-"),
    );
    const shutdownManager = new ShutdownManager();
    const globals = globalThis as LaunchGlobals;
    globals[CONSTRUCTED_HOOK] = () => void shutdownManager.shutdown();
    const previousResolver = (Module as any)._resolveFilename;

    try {
      const manifest = await writeLocalModule(
        path.join(projectFolder, "listener"),
        "listener",
        `exports.construct = () => globalThis.${CONSTRUCTED_HOOK}();
exports.start = () => { globalThis.${STARTED_FLAG} = true; };
`,
      );
      const thrown = await launchInterruptedBy(shutdownManager, async () => ({
        fs: new NodeFileSystem(),
        dev: true,
        loadContext: async () => ({}) as any,
        verify: async () => undefined,
        createEntries: async () => [{ manifest, config: {} }],
      }));

      expect(thrown).to.be.instanceOf(LaunchInterruptedError);
      expect(globals[STARTED_FLAG]).to.equal(undefined);
    } finally {
      delete globals[CONSTRUCTED_HOOK];
      delete globals[STARTED_FLAG];
      (Module as any)._resolveFilename = previousResolver;
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});
