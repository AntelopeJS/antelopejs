import { MODULE_CONTEXT_INVALIDATED_CODE } from "@antelopejs/interface-core";
import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sinon from "sinon";

import launch from "../../src";
import {
  ShutdownManager,
  getActiveShutdownManager,
} from "../../src/core/runtime";

interface TestGlobals {
  [STATE_KEY]?: RestartState;
}
const testGlobals: typeof globalThis & TestGlobals = globalThis;

const STATE_KEY = "__antelopeRestartStaleWork";
const CORE_INTERFACE_NAME = "@antelopejs/interface-core";
const MODULE_ID = "lingering";
const ORPHAN_TIMEOUT_MS = 8000;
const RESTART_TIMEOUT_MS = 8000;
const POLL_MS = 20;
const TEST_TIMEOUT_MS = 30000;

interface RestartState {
  constructed: number;
  started: number;
  holdSecondConstruct: Promise<void>;
}

/**
 * A module whose first `destroy` leaves work on a timer that resumes once its
 * generation is destroyed. The next generation's construction waits on
 * `holdSecondConstruct`, so the restart is still launching when that work fails.
 */
function moduleSource(): string {
  return `
const { ListModules } = require(${JSON.stringify(`${CORE_INTERFACE_NAME}/modules`)});
const state = global[${JSON.stringify(STATE_KEY)}];
exports.construct = async () => {
  state.constructed += 1;
  if (state.constructed === 2) {
    await state.holdSecondConstruct;
  }
};
exports.start = () => { state.started += 1; };
exports.stop = () => {};
exports.destroy = () => {
  if (state.constructed !== 1) {
    return;
  }
  setTimeout(async () => {
    await ListModules();
  }, 0);
};
`;
}

function configSource(name: string): string {
  const modules = {
    [MODULE_ID]: {
      source: { type: "local", path: `./${MODULE_ID}`, main: "index.js" },
    },
  };
  return `export default ${JSON.stringify({ name, modules })};\n`;
}

async function createProject(): Promise<string> {
  const projectFolder = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-restart-stale-work-"),
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
  await fs.writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    configSource("restart-stale-work"),
  );
  return projectFolder;
}

/** Resolves once the destroyed generation's work has failed unhandled. */
function waitForOrphanedFailure(): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      process.off("unhandledRejection", onRejection);
      reject(new Error("The destroyed generation's work never failed"));
    }, ORPHAN_TIMEOUT_MS);
    const onRejection: NodeJS.UnhandledRejectionListener = (reason) => {
      if (
        !(
          reason instanceof Error &&
          "code" in reason &&
          reason.code === MODULE_CONTEXT_INVALIDATED_CODE
        )
      ) {
        return;
      }
      clearTimeout(deadline);
      process.off("unhandledRejection", onRejection);
      setTimeout(resolve, POLL_MS);
    };
    process.on("unhandledRejection", onRejection);
  });
}

async function waitForStarts(
  state: RestartState,
  count: number,
): Promise<void> {
  const deadline = Date.now() + RESTART_TIMEOUT_MS;
  while (state.started < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

describe("a config restart in watch mode", () => {
  let projectFolder = "";

  afterEach(async () => {
    await getActiveShutdownManager()?.shutdown();
    sinon.restore();
    delete testGlobals[STATE_KEY];
    if (projectFolder) {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });

  it("keeps the dev process running when the destroyed generation's work fails mid-restart", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    let releaseSecondConstruct = (): void => {};
    const state: RestartState = {
      constructed: 0,
      started: 0,
      holdSecondConstruct: new Promise((resolve) => {
        releaseSecondConstruct = resolve;
      }),
    };
    testGlobals[STATE_KEY] = state;
    projectFolder = await createProject();
    await launch(projectFolder, "default", { watch: true });
    const shutdown = sinon.spy(ShutdownManager.prototype, "shutdown");
    const exit = sinon.stub(process, "exit");

    const orphanedFailure = waitForOrphanedFailure();
    await fs.writeFile(
      path.join(projectFolder, "antelope.config.ts"),
      configSource("restart-stale-work-edited"),
    );
    await orphanedFailure;
    releaseSecondConstruct();
    await waitForStarts(state, 2);

    expect(shutdown.calledWith(1)).to.equal(false);
    expect(exit.called).to.equal(false);
    expect(state.started).to.equal(2);
  });
});
