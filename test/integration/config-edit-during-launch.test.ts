import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import launch from "../../src";
import { getActiveShutdownManager } from "../../src/core/runtime";

const MARKER_TIMEOUT_MS = 8000;
const MARKER_POLL_MS = 50;

const EDITING_MODULE_SOURCE = `const fs = require("node:fs");
exports.construct = (c) => {
  if (!fs.existsSync(c.editedPath)) {
    fs.writeFileSync(c.editedPath, "");
    fs.writeFileSync(c.configPath, c.editedConfig);
  }
};
exports.start = () => {};
exports.stop = () => {};
exports.destroy = () => {};
`;

const MARKING_MODULE_SOURCE = `const fs = require("node:fs");
let cfg;
exports.construct = (c) => { cfg = c; };
exports.start = () => { fs.writeFileSync(cfg.markerPath, "started"); };
exports.stop = () => {};
exports.destroy = () => {};
`;

async function writeModule(
  projectFolder: string,
  name: string,
  source: string,
): Promise<void> {
  const modulePath = path.join(projectFolder, name);
  await fs.mkdir(modulePath, { recursive: true });
  await fs.writeFile(
    path.join(modulePath, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
  );
  await fs.writeFile(path.join(modulePath, "index.js"), source);
}

async function waitForFile(filePath: string): Promise<boolean> {
  const deadline = Date.now() + MARKER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, MARKER_POLL_MS));
    }
  }
  return false;
}

describe("config edit during a watch-mode launch", () => {
  let projectFolder: string;

  beforeEach(async () => {
    projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-cfg-race-"));
  });

  afterEach(async () => {
    await getActiveShutdownManager()?.shutdown();
    await fs.rm(projectFolder, { recursive: true, force: true });
  });

  it("restarts with a module added to antelope.config.ts before the watcher started", async function () {
    this.timeout(30000);
    const configPath = path.join(projectFolder, "antelope.config.ts");
    const markerPath = path.join(projectFolder, "b-started.txt");
    await writeModule(projectFolder, "a", EDITING_MODULE_SOURCE);
    await writeModule(projectFolder, "b", MARKING_MODULE_SOURCE);
    const moduleB = {
      source: { type: "local", path: "./b", main: "index.js" },
      config: { markerPath },
    };
    const moduleA = (editedConfig: string) => ({
      source: { type: "local", path: "./a", main: "index.js" },
      config: {
        configPath,
        editedPath: path.join(projectFolder, "edited.txt"),
        editedConfig,
      },
    });
    const toSource = (modules: {
      a: ReturnType<typeof moduleA>;
      b?: typeof moduleB;
    }) => `export default ${JSON.stringify({ name: "cfg-race", modules })};\n`;
    const edited = toSource({ a: moduleA(""), b: moduleB });
    await fs.writeFile(configPath, toSource({ a: moduleA(edited) }));

    await launch(projectFolder, "default", { watch: true });

    expect(await waitForFile(markerPath)).to.equal(true);
  });
});
