import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import launch from "../../src";
import { getActiveShutdownManager } from "../../src/core/runtime";

const VALUE_VARIABLE = "AJS_ENV_RELOAD_VALUE";
const MARKER_TIMEOUT_MS = 8000;
const MARKER_POLL_MS = 50;

const MODULE_SOURCE = `const fs = require("node:fs");
let cfg;
exports.construct = (c) => { cfg = c; };
exports.start = () => { fs.writeFileSync(cfg.markerPath, String(cfg.value)); };
exports.stop = () => {};
exports.destroy = () => {};
`;

async function readMarker(markerPath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(markerPath, "utf-8");
  } catch {
    return undefined;
  }
}

async function waitForMarker(markerPath: string, value: string): Promise<void> {
  const deadline = Date.now() + MARKER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await readMarker(markerPath)) === value) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, MARKER_POLL_MS));
  }
  throw new Error(
    `Marker is ${await readMarker(markerPath)}, expected ${value}`,
  );
}

describe("project .env in watch mode", () => {
  let projectFolder: string;

  beforeEach(async () => {
    projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-env-"));
  });

  afterEach(async () => {
    await getActiveShutdownManager()?.shutdown();
    delete process.env[VALUE_VARIABLE];
    await fs.rm(projectFolder, { recursive: true, force: true });
  });

  it("restarts the project with the variables of a created, then edited .env", async function () {
    this.timeout(30000);
    const modulePath = path.join(projectFolder, "mod");
    const markerPath = path.join(projectFolder, "marker.txt");
    const envPath = path.join(projectFolder, ".env");
    await fs.mkdir(modulePath, { recursive: true });
    await fs.writeFile(
      path.join(modulePath, "package.json"),
      JSON.stringify({ name: "mod", version: "1.0.0", main: "index.js" }),
    );
    await fs.writeFile(path.join(modulePath, "index.js"), MODULE_SOURCE);
    const config = {
      name: "env-reload",
      modules: {
        mod: {
          source: { type: "local", path: "./mod", main: "index.js" },
          config: { markerPath, value: "unset" },
        },
      },
      envOverrides: { [VALUE_VARIABLE]: "modules.mod.config.value" },
    };
    await fs.writeFile(
      path.join(projectFolder, "antelope.config.ts"),
      `export default ${JSON.stringify(config)};\n`,
    );

    await launch(projectFolder, "default", { watch: true });
    await waitForMarker(markerPath, "unset");

    await fs.writeFile(envPath, `${VALUE_VARIABLE}=created\n`);
    await waitForMarker(markerPath, "created");

    await fs.writeFile(envPath, `${VALUE_VARIABLE}=edited\n`);
    await waitForMarker(markerPath, "edited");

    expect(process.env[VALUE_VARIABLE]).to.equal("edited");
  });
});
