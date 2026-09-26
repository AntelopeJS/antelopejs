import os from "node:os";
import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";
import fs from "node:fs/promises";
import { MODULE_CONTEXT_INVALIDATED_CODE } from "@antelopejs/interface-core";

import { ModuleState } from "../../src/types";
import { ShutdownManager } from "../../src/core/shutdown";
import launch, { type ModuleManager } from "../../src";
import {
  createLoaderContext,
  reloadWatchedModule,
} from "../../src/core/runtime/module-loading";

const STATE_KEY = "__antelopeFailedReload";
const CORE_INTERFACE_NAME = "@antelopejs/interface-core";
const MODULE_ID = "fragile";
const ORPHAN_DELAY_MS = 50;
const ORPHAN_TIMEOUT_MS = 5000;
const POLL_MS = 20;
const TEST_TIMEOUT_MS = 20000;

interface FailedReloadState {
  constructed: number;
  failNextConstruct: boolean;
}

/**
 * A module whose construction can be made to fail, the way a page missing a
 * required option makes it fail, after it started work it never gets to
 * cancel: that work resumes once its generation is destroyed.
 */
function moduleSource(): string {
  return `
const { ListModules } = require(${JSON.stringify(`${CORE_INTERFACE_NAME}/modules`)});
const state = global[${JSON.stringify(STATE_KEY)}];
exports.construct = async () => {
  if (state.failNextConstruct) {
    setTimeout(async () => {
      await ListModules();
    }, ${ORPHAN_DELAY_MS});
    throw new Error("page is missing a required option");
  }
  state.constructed += 1;
};
exports.start = () => {};
exports.stop = () => {};
exports.destroy = () => {};
`;
}

async function createProject(): Promise<string> {
  const projectFolder = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-failed-reload-"),
  );
  const moduleFolder = path.join(projectFolder, MODULE_ID);
  await fs.mkdir(path.join(moduleFolder, "node_modules", "@antelopejs"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(moduleFolder, "package.json"),
    JSON.stringify({
      name: MODULE_ID,
      version: "1.0.0",
      main: "index.js",
      dependencies: { [CORE_INTERFACE_NAME]: "*" },
    }),
  );
  await fs.writeFile(path.join(moduleFolder, "index.js"), moduleSource());
  await fs.symlink(
    path.dirname(require.resolve(`${CORE_INTERFACE_NAME}/package.json`)),
    path.join(moduleFolder, "node_modules", CORE_INTERFACE_NAME),
    "dir",
  );
  const modules = {
    [MODULE_ID]: {
      source: { type: "local", path: `./${MODULE_ID}`, main: "index.js" },
    },
  };
  await fs.writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify({ name: "failed-reload-test", modules })};\n`,
  );
  return projectFolder;
}

async function reloadModule(
  manager: ModuleManager,
  projectFolder: string,
): Promise<void> {
  const loaderContext = await createLoaderContext({
    projectFolder,
    cacheFolder: path.join(projectFolder, ".cache"),
  });
  await reloadWatchedModule(manager, MODULE_ID, loaderContext);
}

function isInvalidatedModuleError(reason: unknown): boolean {
  return (
    reason instanceof Error &&
    "code" in reason &&
    reason.code === MODULE_CONTEXT_INVALIDATED_CODE
  );
}

/** Resolves once the destroyed generation's work has failed unhandled. */
function waitForOrphanedFailure(): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      process.off("unhandledRejection", onRejection);
      reject(new Error("The destroyed generation's work never failed"));
    }, ORPHAN_TIMEOUT_MS);
    const onRejection = (reason: unknown) => {
      if (!isInvalidatedModuleError(reason)) {
        return;
      }
      clearTimeout(deadline);
      process.off("unhandledRejection", onRejection);
      setTimeout(resolve, POLL_MS);
    };
    process.on("unhandledRejection", onRejection);
  });
}

describe("a module that fails to reload in watch mode", () => {
  let manager: ModuleManager | undefined;
  let projectFolder = "";

  afterEach(async () => {
    sinon.restore();
    if (manager) {
      await manager.stopAll();
      await manager.destroyAll();
      manager = undefined;
    }
    delete (global as Record<string, unknown>)[STATE_KEY];
    if (projectFolder) {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });

  it("keeps the dev process running, and reloads the module on the next change", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const state: FailedReloadState = {
      constructed: 0,
      failNextConstruct: false,
    };
    (global as Record<string, unknown>)[STATE_KEY] = state;
    projectFolder = await createProject();
    manager = await launch(projectFolder, "default", { watch: true });
    const shutdown = sinon.spy(ShutdownManager.prototype, "shutdown");
    sinon.stub(process, "exit");

    state.failNextConstruct = true;
    const orphanedFailure = waitForOrphanedFailure();
    const reloadFailure = await reloadModule(manager, projectFolder).catch(
      (error: unknown) => error,
    );
    await orphanedFailure;

    expect(reloadFailure).to.be.instanceOf(AggregateError);
    expect(shutdown.called).to.equal(false);

    state.failNextConstruct = false;
    await reloadModule(manager, projectFolder);

    expect(state.constructed).to.equal(2);
    expect(manager.getLoadedModuleEntry(MODULE_ID)?.module.state).to.equal(
      ModuleState.Active,
    );
  });
});
