import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import launch, { type ModuleManager } from "../../src";
import {
  createLoaderContext,
  getActiveShutdownManager,
  reloadWatchedModule,
} from "../../src/core/runtime";

const STATE_KEY = "__antelopeSymlinkedReload";
const MODULE_ID = "linked";
const CORE_INTERFACE_NAME = "@antelopejs/interface-core";
const TEST_TIMEOUT_MS = 20000;

interface TestGlobals {
  [STATE_KEY]?: string[];
}
const testGlobals: typeof globalThis & TestGlobals = globalThis;

interface LinkedProject {
  root: string;
  project: string;
  checkoutLib: string;
}

async function writeVersion(folder: string, version: string): Promise<void> {
  await fs.writeFile(
    path.join(folder, "version.js"),
    `module.exports = ${JSON.stringify(version)};\n`,
  );
}

/**
 * A project whose local module folder is a real folder that links its code
 * folder to a checkout outside it, the layout of a run's copy of a
 * repository: Node caches the module's files under the checkout's paths.
 */
async function createLinkedProject(): Promise<LinkedProject> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "ajs-symlinked-reload-")),
  );
  const checkoutLib = path.join(root, "checkout", "lib");
  const project = path.join(root, "project");
  const moduleFolder = path.join(project, MODULE_ID);
  await fs.mkdir(checkoutLib, { recursive: true });
  await fs.mkdir(path.join(moduleFolder, "node_modules", "@antelopejs"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(checkoutLib, "index.js"),
    `const version = require("./version");
exports.construct = () => { global[${JSON.stringify(STATE_KEY)}].push(version); };
exports.start = () => {};
exports.stop = () => {};
exports.destroy = () => {};
`,
  );
  await writeVersion(checkoutLib, "v1");
  await fs.writeFile(
    path.join(moduleFolder, "package.json"),
    JSON.stringify({ name: MODULE_ID, version: "1.0.0", main: "lib/index.js" }),
  );
  await fs.symlink(checkoutLib, path.join(moduleFolder, "lib"), "dir");
  await fs.symlink(
    path.dirname(require.resolve(`${CORE_INTERFACE_NAME}/package.json`)),
    path.join(moduleFolder, "node_modules", CORE_INTERFACE_NAME),
    "dir",
  );
  const modules = {
    [MODULE_ID]: {
      source: { type: "local", path: `./${MODULE_ID}`, main: "lib/index.js" },
    },
  };
  await fs.writeFile(
    path.join(project, "antelope.config.ts"),
    `export default ${JSON.stringify({ name: "symlinked-reload-test", modules })};\n`,
  );
  return { root, project, checkoutLib };
}

async function stopProject(manager: ModuleManager): Promise<void> {
  await manager.stopAll();
  await manager.destroyAll();
  await getActiveShutdownManager()?.shutdown();
}

describe("a local module whose code folder links outside it", () => {
  let manager: ModuleManager | undefined;
  let root = "";

  afterEach(async () => {
    if (manager) {
      await stopProject(manager);
      manager = undefined;
    }
    delete testGlobals[STATE_KEY];
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("loads its edited code when watch mode reloads it", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const constructed: string[] = [];
    testGlobals[STATE_KEY] = constructed;
    const linked = await createLinkedProject();
    root = linked.root;
    manager = await launch(linked.project, "default", { watch: true });

    await writeVersion(linked.checkoutLib, "v2");
    const loaderContext = await createLoaderContext({
      projectFolder: linked.project,
      cacheFolder: path.join(linked.project, ".cache"),
    });
    await reloadWatchedModule(manager, MODULE_ID, loaderContext);

    expect(constructed).to.deep.equal(["v1", "v2"]);
  });

  it("loads its edited code when the project restarts", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const constructed: string[] = [];
    testGlobals[STATE_KEY] = constructed;
    const linked = await createLinkedProject();
    root = linked.root;
    await stopProject(await launch(linked.project, "default", { watch: true }));

    await writeVersion(linked.checkoutLib, "v2");
    manager = await launch(linked.project, "default", { watch: true });

    expect(constructed).to.deep.equal(["v1", "v2"]);
  });
});
