import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import fs from "node:fs/promises";
import { type ChildProcess, spawn } from "node:child_process";

import { CANCELLED_EXIT_CODE } from "../../src/core/cli/exit-codes";

const CLI_ENTRY = path.resolve(__dirname, "../../src/core/cli/index.ts");
const TEST_TIMEOUT_MS = 90000;
const STARTING_MARKER = "spawner: child started";
const RUNNING_MARKER = "spawner: running";
const RUNNING_DELAY_MS = 500;
const CHILD_PID_FILE = "child.pid";
const STILL_STARTING_MS = 2000;
const REAP_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 50;
const SIGKILL = "SIGKILL";

interface StopResult {
  code: number | null;
  signal: string | null;
  stderr: string;
}

/**
 * A module that starts a detached child process, the way a module starts a
 * sidecar or a dev server, and leaves it running: the child does not get the
 * terminal's Ctrl+C, so only the core can stop it.
 */
async function createSpawningProject(startDelayMs: number): Promise<string> {
  const projectFolder = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-dev-stop-"),
  );
  const moduleFolder = path.join(projectFolder, "spawner");
  await fs.mkdir(moduleFolder);
  await fs.writeFile(
    path.join(moduleFolder, "package.json"),
    JSON.stringify({ name: "spawner", version: "1.0.0", main: "index.js" }),
  );
  await fs.writeFile(
    path.join(moduleFolder, "index.js"),
    `const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
exports.start = async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  fs.writeFileSync(path.join(${JSON.stringify(projectFolder)}, ${JSON.stringify(CHILD_PID_FILE)}), String(child.pid));
  console.log(${JSON.stringify(STARTING_MARKER)});
  await new Promise((resolve) => setTimeout(resolve, ${startDelayMs}));
  setTimeout(() => console.log(${JSON.stringify(RUNNING_MARKER)}), ${RUNNING_DELAY_MS});
};
`,
  );
  await fs.writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify({
      name: "dev-stop",
      modules: {
        spawner: {
          source: { type: "local", path: "./spawner", main: "index.js" },
        },
      },
    })};\n`,
  );
  return projectFolder;
}

function startDev(projectFolder: string): ChildProcess {
  return spawn(
    process.execPath,
    [
      "-r",
      "ts-node/register",
      CLI_ENTRY,
      "project",
      "dev",
      "-p",
      projectFolder,
    ],
    {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "true" },
    },
  );
}

function interruptOn(cli: ChildProcess, marker: string): Promise<StopResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    cli.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.includes(marker)) {
        stdout = "";
        cli.kill("SIGINT");
      }
    });
    cli.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    cli.on("error", reject);
    cli.on("close", (code, signal) => resolve({ code, signal, stderr }));
  });
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilGone(pid: number): Promise<boolean> {
  const deadline = Date.now() + REAP_TIMEOUT_MS;
  while (isRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return !isRunning(pid);
}

async function readChildPid(projectFolder: string): Promise<number> {
  const content = await fs.readFile(
    path.join(projectFolder, CHILD_PID_FILE),
    "utf8",
  );
  return Number.parseInt(content, 10);
}

async function stopDevProject(startDelayMs: number, marker: string) {
  const projectFolder = await createSpawningProject(startDelayMs);
  let childPid: number | undefined;
  try {
    const result = await interruptOn(startDev(projectFolder), marker);
    childPid = await readChildPid(projectFolder);
    return { ...result, isChildGone: await waitUntilGone(childPid) };
  } finally {
    if (childPid !== undefined && isRunning(childPid)) {
      process.kill(childPid, SIGKILL);
    }
    await fs.rm(projectFolder, { recursive: true, force: true });
  }
}

describe("stopping ajs project dev", function () {
  if (process.platform !== "linux") {
    return;
  }
  this.timeout(TEST_TIMEOUT_MS);

  it("exits with the cancelled exit code and stops the processes modules started", async () => {
    const result = await stopDevProject(0, RUNNING_MARKER);

    expect(result.signal).to.equal(null);
    expect(result.code).to.equal(CANCELLED_EXIT_CODE);
    expect(result.stderr).to.contain("Stopped the project");
    expect(result.isChildGone).to.equal(true);
  });

  it("stops the project the same way while its modules are still starting", async () => {
    const result = await stopDevProject(STILL_STARTING_MS, STARTING_MARKER);

    expect(result.signal).to.equal(null);
    expect(result.code).to.equal(CANCELLED_EXIT_CODE);
    expect(result.stderr).to.contain("Stopped the project");
    expect(result.isChildGone).to.equal(true);
  });
});
