import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import launch, { type ModuleManager } from "../../src";

const MARKER_TIMEOUT_MS = 8000;
const MARKER_POLL_MS = 50;
const NO_RELOAD_WINDOW_MS = 3000;

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, MARKER_POLL_MS));
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
}

async function readMarker(markerPath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(markerPath, "utf-8");
  } catch {
    return undefined;
  }
}

async function assertStableStartCount(
  startCountPath: string,
  expected: number,
  windowMs: number,
): Promise<void> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const current = parseInt(await fs.readFile(startCountPath, "utf-8"), 10);
    if (current !== expected) {
      throw new Error(
        `Expected startCount to stay at ${expected}, observed ${current}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, MARKER_POLL_MS));
  }
}

function moduleSource(version: string): string {
  return `const fs = require("node:fs");
let cfg;
exports.construct = (c) => { cfg = c; };
exports.start = () => { fs.writeFileSync(cfg.markerPath, "${version}"); };
exports.stop = () => {};
exports.destroy = () => {};
`;
}

describe("HMR end-to-end", () => {
  it("picks up module source edits and runs new code after reload", async function () {
    this.timeout(20000);

    const projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-hmr-"));
    const modulePath = path.join(projectFolder, "mod");
    const markerPath = path.join(projectFolder, "marker.txt");
    const indexPath = path.join(modulePath, "index.js");

    await fs.mkdir(modulePath, { recursive: true });
    await fs.writeFile(
      path.join(modulePath, "package.json"),
      JSON.stringify({ name: "mod", version: "1.0.0", main: "index.js" }),
    );
    await fs.writeFile(indexPath, moduleSource("v1"));

    const config = {
      name: "hmr-test",
      modules: {
        mod: {
          source: { type: "local", path: "./mod", main: "index.js" },
          config: { markerPath },
        },
      },
    };
    await fs.writeFile(
      path.join(projectFolder, "antelope.config.ts"),
      `export default ${JSON.stringify(config)};\n`,
    );

    let manager: ModuleManager | undefined;
    try {
      manager = await launch(projectFolder, "default", { watch: true });

      await waitFor(async () => (await readMarker(markerPath)) === "v1", 2000);

      await fs.writeFile(indexPath, moduleSource("v2"));

      await waitFor(
        async () => (await readMarker(markerPath)) === "v2",
        MARKER_TIMEOUT_MS,
      );

      expect(await readMarker(markerPath)).to.equal("v2");
    } finally {
      if (manager) {
        await manager.stopAll();
        await manager.destroyAll();
      }
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });

  it("does not reload when atomic-write temp files appear", async function () {
    this.timeout(20000);

    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-hmr-atomic-"),
    );
    const modulePath = path.join(projectFolder, "mod");
    const markerPath = path.join(projectFolder, "marker.txt");
    const indexPath = path.join(modulePath, "index.js");
    const startCountPath = path.join(projectFolder, "start-count.txt");

    await fs.mkdir(modulePath, { recursive: true });
    await fs.writeFile(
      path.join(modulePath, "package.json"),
      JSON.stringify({ name: "mod", version: "1.0.0", main: "index.js" }),
    );
    const src = `const fs = require("node:fs");
let cfg;
exports.construct = (c) => { cfg = c; };
exports.start = () => {
  const prev = fs.existsSync(cfg.startCountPath)
    ? parseInt(fs.readFileSync(cfg.startCountPath, "utf-8"), 10) || 0
    : 0;
  fs.writeFileSync(cfg.startCountPath, String(prev + 1));
  fs.writeFileSync(cfg.markerPath, "v1");
};
exports.stop = () => {};
exports.destroy = () => {};
`;
    await fs.writeFile(indexPath, src);

    const config = {
      name: "hmr-atomic-test",
      modules: {
        mod: {
          source: { type: "local", path: "./mod", main: "index.js" },
          config: { markerPath, startCountPath },
        },
      },
    };
    await fs.writeFile(
      path.join(projectFolder, "antelope.config.ts"),
      `export default ${JSON.stringify(config)};\n`,
    );

    let manager: ModuleManager | undefined;
    try {
      manager = await launch(projectFolder, "default", { watch: true });
      await waitFor(async () => (await readMarker(markerPath)) === "v1", 2000);

      const tmpPath = path.join(modulePath, "index.js.tmp.9999");
      await fs.writeFile(tmpPath, "intermediate garbage");
      await fs.rm(tmpPath);

      await assertStableStartCount(startCountPath, 1, NO_RELOAD_WINDOW_MS);

      const startCount = parseInt(
        await fs.readFile(startCountPath, "utf-8"),
        10,
      );
      expect(startCount).to.equal(1);
    } finally {
      if (manager) {
        await manager.stopAll();
        await manager.destroyAll();
      }
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});
