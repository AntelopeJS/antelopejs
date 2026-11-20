import {
  HoldReloads,
  ReleaseReloads,
} from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import launch from "../../src";
import { getActiveShutdownManager } from "../../src/core/runtime";

const TIMEOUT_MS = 8000;
const POLL_MS = 50;
const EDIT_COUNT = 3;
const EDIT_INTERVAL_MS = 700;
const VALUE_VARIABLE = "AJS_RELOAD_HOLD_VALUE";

const COUNTING_MODULE = `const fs = require("node:fs");
let cfg;
exports.construct = (c) => { cfg = c; };
exports.start = () => { fs.appendFileSync(cfg.startsPath, String(cfg.value) + "\\n"); };
exports.stop = () => {};
exports.destroy = () => {};
`;

const HOLDING_MODULE = `const fs = require("node:fs");
const { HoldReloads } = require("@antelopejs/interface-core/modules");
let cfg;
exports.construct = (c) => { cfg = c; };
exports.start = async () => { fs.writeFileSync(cfg.holdPath, await HoldReloads()); };
exports.stop = () => {};
exports.destroy = () => {};
`;

interface HeldProject {
  folder: string;
  startsPath: string;
  holdPath: string;
  sourcePath: string;
  envPath: string;
}

async function writeModule(
  folder: string,
  name: string,
  source: string,
): Promise<string> {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
  );
  const sourcePath = path.join(folder, "index.js");
  await fs.writeFile(sourcePath, source);
  return sourcePath;
}

async function writeHeldProject(folder: string): Promise<HeldProject> {
  const startsPath = path.join(folder, "starts.log");
  const holdPath = path.join(folder, "hold.txt");
  const sourcePath = await writeModule(
    path.join(folder, "mod"),
    "mod",
    COUNTING_MODULE,
  );
  await writeModule(path.join(folder, "holder"), "holder", HOLDING_MODULE);
  const config = {
    name: "reload-holds",
    modules: {
      mod: {
        source: { type: "local", path: "./mod", main: "index.js" },
        config: { startsPath, value: "unset" },
      },
      holder: {
        source: { type: "local", path: "./holder", main: "index.js" },
        config: { holdPath },
      },
    },
    envOverrides: { [VALUE_VARIABLE]: "modules.mod.config.value" },
  };
  await fs.writeFile(
    path.join(folder, "antelope.config.ts"),
    `export default ${JSON.stringify(config)};\n`,
  );
  return {
    folder,
    startsPath,
    holdPath,
    sourcePath,
    envPath: path.join(folder, ".env"),
  };
}

async function readStarts(startsPath: string): Promise<string[]> {
  try {
    return (await fs.readFile(startsPath, "utf-8")).split("\n").slice(0, -1);
  } catch {
    return [];
  }
}

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!(await condition())) {
    if (Date.now() >= deadline) {
      throw new Error("Condition not met in time");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function launchHeld(project: HeldProject): Promise<string> {
  await launch(project.folder, "default", { watch: true });
  await waitFor(async () => (await readStarts(project.startsPath)).length > 0);
  return fs.readFile(project.holdPath, "utf-8");
}

/** Writes the module's source `EDIT_COUNT` times, each past the debounce. */
async function editModuleRepeatedly(project: HeldProject): Promise<void> {
  for (let edit = 1; edit <= EDIT_COUNT; edit += 1) {
    await fs.writeFile(
      project.sourcePath,
      `${COUNTING_MODULE}exports.edit = ${edit};\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, EDIT_INTERVAL_MS));
  }
}

async function stopProjects(): Promise<void> {
  for (
    let running = getActiveShutdownManager();
    running;
    running = getActiveShutdownManager()
  ) {
    await running.shutdown();
  }
}

describe("reload holds in watch mode", function () {
  this.timeout(30000);
  let project: HeldProject;

  beforeEach(async () => {
    project = await writeHeldProject(
      await fs.mkdtemp(path.join(os.tmpdir(), "ajs-reload-holds-")),
    );
  });

  afterEach(async () => {
    await stopProjects();
    delete process.env[VALUE_VARIABLE];
    await fs.rm(project.folder, { recursive: true, force: true });
  });

  it("reloads a module edited during a hold once, before the release resolves", async () => {
    const holdId = await launchHeld(project);

    await editModuleRepeatedly(project);
    const startsDuringHold = await readStarts(project.startsPath);
    await ReleaseReloads(holdId);

    expect({
      duringHold: startsDuringHold.length,
      afterRelease: (await readStarts(project.startsPath)).length,
    }).to.deep.equal({ duringHold: 1, afterRelease: 2 });
  });

  it("reloads once for writes the watcher has not reported when the release comes", async () => {
    const holdId = await launchHeld(project);

    for (let edit = 1; edit <= 10; edit += 1) {
      await fs.writeFile(
        project.sourcePath,
        `${COUNTING_MODULE}exports.edit = ${edit};\n`,
      );
    }
    await ReleaseReloads(holdId);
    const afterRelease = (await readStarts(project.startsPath)).length;
    await new Promise((resolve) => setTimeout(resolve, EDIT_INTERVAL_MS * 2));

    expect({
      afterRelease,
      later: (await readStarts(project.startsPath)).length,
    }).to.deep.equal({ afterRelease: 2, later: 2 });
  });

  it("restarts the project at release for a .env write the watcher has not reported", async () => {
    const holdId = await launchHeld(project);

    await fs.writeFile(project.envPath, `${VALUE_VARIABLE}=late\n`);
    await ReleaseReloads(holdId);

    expect(await readStarts(project.startsPath)).to.deep.equal([
      "unset",
      "late",
    ]);
  });

  it("keeps a due restart for a hold taken while the release waits for the watcher", async () => {
    const holdId = await launchHeld(project);
    await fs.writeFile(project.envPath, `${VALUE_VARIABLE}=late\n`);
    await new Promise((resolve) => setTimeout(resolve, EDIT_INTERVAL_MS));

    const release = ReleaseReloads(holdId);
    const nextHold = await HoldReloads();
    await release;
    const startsDuringNextHold = await readStarts(project.startsPath);
    await ReleaseReloads(nextHold);

    expect({
      duringNextHold: startsDuringNextHold,
      afterRelease: await readStarts(project.startsPath),
    }).to.deep.equal({
      duringNextHold: ["unset"],
      afterRelease: ["unset", "late"],
    });
  });

  it("restarts the project once at release for .env changes during a hold", async () => {
    const holdId = await launchHeld(project);

    await fs.writeFile(project.envPath, `${VALUE_VARIABLE}=first\n`);
    await new Promise((resolve) => setTimeout(resolve, EDIT_INTERVAL_MS));
    await fs.writeFile(project.envPath, `${VALUE_VARIABLE}=second\n`);
    await new Promise((resolve) => setTimeout(resolve, EDIT_INTERVAL_MS));
    const startsDuringHold = await readStarts(project.startsPath);
    await ReleaseReloads(holdId);

    expect({
      duringHold: startsDuringHold,
      afterRelease: await readStarts(project.startsPath),
    }).to.deep.equal({
      duringHold: ["unset"],
      afterRelease: ["unset", "second"],
    });
  });

  it("ends a hold when the module that took it is destroyed", async () => {
    const manager = await launch(project.folder, "default", { watch: true });
    await waitFor(
      async () => (await readStarts(project.startsPath)).length > 0,
    );

    await editModuleRepeatedly(project);
    const startsDuringHold = await readStarts(project.startsPath);
    await manager.getModule("holder")?.destroy();
    await waitFor(
      async () => (await readStarts(project.startsPath)).length > 1,
    );
    await new Promise((resolve) => setTimeout(resolve, EDIT_INTERVAL_MS));

    expect({
      duringHold: startsDuringHold.length,
      afterDestroy: (await readStarts(project.startsPath)).length,
    }).to.deep.equal({ duringHold: 1, afterDestroy: 2 });
  });
});
