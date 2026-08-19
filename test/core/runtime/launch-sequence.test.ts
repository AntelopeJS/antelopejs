import fs from "node:fs/promises";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";
import * as runtimeInterface from "@antelopejs/interface-core/runtime";
import { expect } from "chai";
import sinon from "sinon";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { ModuleManifest } from "../../../src/core/module-manifest";
import { runLaunchSequence } from "../../../src/core/runtime/launch-sequence";
import type { ProjectPreparer } from "../../../src/core/runtime/runtime-types";
import { ShutdownManager } from "../../../src/core/shutdown";

describe("runtime launch-sequence", () => {
  afterEach(() => {
    sinon.restore();
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
