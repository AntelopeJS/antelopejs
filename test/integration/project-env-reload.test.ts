import { expect } from "chai";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sinon from "sinon";

import launch from "../../src";
import {
  getActiveShutdownManager,
  processClaimModule as processClaim,
  type ShutdownManager,
} from "../../src/core/runtime";

const VALUE_VARIABLE = "AJS_ENV_RELOAD_VALUE";
const MARKER_TIMEOUT_MS = 8000;
const MARKER_POLL_MS = 50;
const SHUTDOWN_PRIORITY_FIRST = 100;

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

interface EnvProject {
  markerPath: string;
  envPath: string;
}

async function writeEnvProject(projectFolder: string): Promise<EnvProject> {
  const modulePath = path.join(projectFolder, "mod");
  const markerPath = path.join(projectFolder, "marker.txt");
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
  return { markerPath, envPath: path.join(projectFolder, ".env") };
}

/** Resolves with the shutdown manager of the next launch once it claims the process. */
async function waitForNextLaunch(
  previous: ShutdownManager | undefined,
): Promise<ShutdownManager> {
  const deadline = Date.now() + MARKER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = getActiveShutdownManager();
    if (current && current !== previous) {
      return current;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("No restart claimed the process");
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + MARKER_TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Condition not met in time");
    }
    await new Promise((resolve) => setTimeout(resolve, MARKER_POLL_MS));
  }
}

/**
 * Stops the project, then any project a restart launches once the one it
 * replaces has stopped: a restart under way when the test ends would otherwise
 * keep running into the next test.
 */
async function stopProjects(): Promise<void> {
  for (
    let running = getActiveShutdownManager();
    running;
    running = getActiveShutdownManager()
  ) {
    await running.shutdown();
  }
}

describe("project .env in watch mode", () => {
  let projectFolder: string;

  beforeEach(async () => {
    projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-env-"));
  });

  afterEach(async () => {
    await stopProjects();
    delete process.env[VALUE_VARIABLE];
    await fs.rm(projectFolder, { recursive: true, force: true });
  });

  it("restarts the project with the variables of a created, then edited .env", async function () {
    this.timeout(30000);
    const { markerPath, envPath } = await writeEnvProject(projectFolder);

    await launch(projectFolder, "default", { watch: true });
    await waitForMarker(markerPath, "unset");

    await fs.writeFile(envPath, `${VALUE_VARIABLE}=created\n`);
    await waitForMarker(markerPath, "created");

    await fs.writeFile(envPath, `${VALUE_VARIABLE}=edited\n`);
    await waitForMarker(markerPath, "edited");

    expect(process.env[VALUE_VARIABLE]).to.equal("edited");
  });

  it("ends a restart that a shutdown interrupts without exiting the process", async function () {
    this.timeout(30000);
    const { markerPath, envPath } = await writeEnvProject(projectFolder);
    await launch(projectFolder, "default", { watch: true });
    await waitForMarker(markerPath, "unset");
    const recordRejection = sinon.spy();
    const exit = sinon.stub(process, "exit");
    process.on("unhandledRejection", recordRejection);
    try {
      const running = getActiveShutdownManager();
      await fs.writeFile(envPath, `${VALUE_VARIABLE}=interrupted\n`);
      await (await waitForNextLaunch(running)).shutdown();
      await new Promise((resolve) => setTimeout(resolve, MARKER_POLL_MS));
    } finally {
      process.removeListener("unhandledRejection", recordRejection);
      exit.restore();
    }

    expect({
      exitCodes: exit.args.map(([code]) => code),
      rejections: recordRejection.args.map(([reason]) => String(reason)),
    }).to.deep.equal({
      exitCodes: [],
      rejections: [],
    });
  });

  it("launches no project for a change seen while the project shuts down", async function () {
    this.timeout(30000);
    const { markerPath, envPath } = await writeEnvProject(projectFolder);
    await launch(projectFolder, "default", { watch: true });
    await waitForMarker(markerPath, "unset");
    const running = getActiveShutdownManager();
    assert.ok(running);
    const lookups = sinon.spy(processClaim, "getActiveShutdownManager");
    running.register(async () => {
      await fs.writeFile(envPath, `${VALUE_VARIABLE}=late\n`);
      await waitUntil(() => lookups.called);
    }, SHUTDOWN_PRIORITY_FIRST);
    try {
      await running.shutdown();
      await new Promise((resolve) => setTimeout(resolve, MARKER_POLL_MS));
    } finally {
      lookups.restore();
    }

    expect({
      restartRan: lookups.called,
      running: getActiveShutdownManager(),
    }).to.deep.equal({ restartRan: true, running: undefined });
  });
});
