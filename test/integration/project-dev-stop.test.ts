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
const PROMPT_EXIT_MS = 5000;
const CONSTRUCTING_MARKER = "blocker: constructing";
const STARTED_MARKER = "blocker: started";
const CONSTRUCT_BLOCK_MS = 1500;
const REGISTRY_LOOKUP_FILE = "registry-lookup.pid";
const UNCHECKED_VERSION_WARNING = "Could not check latest version";

interface StopResult {
  code: number | null;
  signal: string | null;
  stderr: string;
}

interface TimedStopResult extends StopResult {
  stdout: string;
  elapsedMs: number;
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

async function createProjectFolder(
  config: Record<string, unknown>,
): Promise<string> {
  const projectFolder = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-dev-stop-"),
  );
  await fs.writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify(config)};\n`,
  );
  return projectFolder;
}

/**
 * A module that blocks the event loop while it is constructed, as loading a
 * large module does, and says when it starts.
 */
async function createBlockingProject(): Promise<string> {
  const projectFolder = await createProjectFolder({
    name: "dev-stop-blocking",
    modules: {
      blocker: {
        source: { type: "local", path: "./blocker", main: "index.js" },
      },
    },
  });
  const moduleFolder = path.join(projectFolder, "blocker");
  await fs.mkdir(moduleFolder);
  await fs.writeFile(
    path.join(moduleFolder, "package.json"),
    JSON.stringify({ name: "blocker", version: "1.0.0", main: "index.js" }),
  );
  await fs.writeFile(
    path.join(moduleFolder, "index.js"),
    `exports.construct = () => {
  console.log(${JSON.stringify(CONSTRUCTING_MARKER)});
  const end = Date.now() + ${CONSTRUCT_BLOCK_MS};
  while (Date.now() < end) {}
};
exports.start = () => console.log(${JSON.stringify(STARTED_MARKER)});
`,
  );
  return projectFolder;
}

/**
 * A project with a module from npm, and an `npm` on the PATH that never
 * answers: the module version check waits on the registry until stopped.
 */
async function createUnreachableRegistryProject(): Promise<string> {
  const projectFolder = await createProjectFolder({
    name: "dev-stop-registry",
    modules: {
      remote: {
        source: {
          type: "package",
          package: "ajs-unreachable",
          version: "1.0.0",
        },
      },
    },
  });
  const binFolder = path.join(projectFolder, "bin");
  await fs.mkdir(binFolder);
  await fs.writeFile(
    path.join(binFolder, "npm"),
    `#!/bin/sh\necho $$ > ${JSON.stringify(path.join(projectFolder, REGISTRY_LOOKUP_FILE))}\nexec sleep 60\n`,
    { mode: 0o755 },
  );
  return projectFolder;
}

function startDev(
  projectFolder: string,
  env: NodeJS.ProcessEnv = process.env,
): ChildProcess {
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
      env: { ...env, TS_NODE_TRANSPILE_ONLY: "true" },
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

function interruptWhen(
  cli: ChildProcess,
  isReady: (stdout: string) => Promise<boolean>,
): Promise<TimedStopResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let interruptedAt: number | undefined;
    const poll = setInterval(async () => {
      if (interruptedAt === undefined && (await isReady(stdout))) {
        interruptedAt = Date.now();
        cli.kill("SIGINT");
      }
    }, POLL_INTERVAL_MS);
    cli.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    cli.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    cli.on("error", reject);
    cli.on("close", (code, signal) => {
      clearInterval(poll);
      const elapsedMs = Date.now() - (interruptedAt ?? Date.now());
      resolve({ code, signal, stderr, stdout, elapsedMs });
    });
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
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

  it("stops at once while the module version check waits on the registry", async () => {
    const projectFolder = await createUnreachableRegistryProject();
    const lookupFile = path.join(projectFolder, REGISTRY_LOOKUP_FILE);
    let lookupPid: number | undefined;
    try {
      const result = await interruptWhen(
        startDev(projectFolder, {
          ...process.env,
          PATH: `${path.join(projectFolder, "bin")}${path.delimiter}${process.env.PATH}`,
        }),
        () => fileExists(lookupFile),
      );
      lookupPid = Number.parseInt(await fs.readFile(lookupFile, "utf8"), 10);

      expect(result.code).to.equal(CANCELLED_EXIT_CODE);
      expect(result.elapsedMs).to.be.below(PROMPT_EXIT_MS);
      expect(result.stderr).to.contain("Stopped the project");
      expect(result.stderr).to.not.contain(UNCHECKED_VERSION_WARNING);
      expect(await waitUntilGone(lookupPid)).to.equal(true);
    } finally {
      if (lookupPid !== undefined && isRunning(lookupPid)) {
        process.kill(lookupPid, SIGKILL);
      }
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });

  it("starts no module when interrupted while the modules are constructed", async () => {
    const projectFolder = await createBlockingProject();
    try {
      const result = await interruptWhen(
        startDev(projectFolder),
        async (stdout) => stdout.includes(CONSTRUCTING_MARKER),
      );

      expect(result.code).to.equal(CANCELLED_EXIT_CODE);
      expect(result.stderr).to.contain("Stopped the project");
      expect(result.stdout).to.not.contain(STARTED_MARKER);
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});
