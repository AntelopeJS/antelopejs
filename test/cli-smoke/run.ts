import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildProcessInvocation } from "../../src/core/output";
import { listDirectory, readText } from "../helpers/temp";

const root = path.resolve(__dirname, "../..");
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ajs-cli-smoke-"));
const prefix = path.join(temp, "prefix");
const ajs = isWindows
  ? path.join(prefix, "ajs.cmd")
  : path.join(prefix, "bin", "ajs");
const env: NodeJS.ProcessEnv = {
  ...process.env,
  AJS_NO_UPDATE_CHECK: "1",
  CI: "1",
  HOME: temp,
  USERPROFILE: temp,
};
const WATCH_MARKER = "cliSmokeReload";
const WATCH_SETTLE_MS = 10_000;
const WATCH_DEADLINE_MS = 120_000;
const POLL_MS = 500;
const OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

function spawnInvocation(command: string, args: string[]) {
  const invocation = buildProcessInvocation(command, args);
  return {
    executable: invocation.executable,
    args: invocation.args,
    options: {
      env,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    },
  };
}

function run(command: string, args: string[], cwd: string): void {
  const {
    executable,
    args: spawnArgs,
    options,
  } = spawnInvocation(command, args);
  const result = spawnSync(executable, spawnArgs, {
    ...options,
    cwd,
    encoding: "utf8",
    maxBuffer: OUTPUT_LIMIT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} ${args.join(" ")} exited with ${result.status ?? result.signal}\n${result.stdout}${result.stderr}`,
    );
  }
}

function installPackedCli(): void {
  const packFolder = path.join(temp, "pack");
  fs.mkdirSync(packFolder, { recursive: true });
  run(
    pnpm,
    ["pack", "--config.ignore-scripts=true", "--pack-destination", packFolder],
    root,
  );
  const tarball = listDirectory(packFolder).find((file) =>
    file.endsWith(".tgz"),
  );
  if (!tarball) {
    throw new Error("pnpm pack did not produce a tarball.");
  }
  run(
    npm,
    [
      "install",
      "--global",
      "--prefix",
      prefix,
      "--ignore-scripts",
      path.join(packFolder, tarball),
    ],
    temp,
  );
  run(ajs, ["--version"], temp);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  check: () => boolean,
  child: ChildProcess,
  what: string,
): Promise<void> {
  const deadline = Date.now() + WATCH_DEADLINE_MS;
  while (!check()) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`ajs project dev --watch exited before ${what}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`ajs project dev --watch timed out before ${what}`);
    }
    await delay(POLL_MS);
  }
}

function stopTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  if (isWindows) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  process.kill(-child.pid, "SIGKILL");
}

async function verifyWatchReload(app: string): Promise<void> {
  const builtEntry = path.join(app, "dist", "index.js");
  fs.rmSync(path.join(app, "dist"), { recursive: true, force: true });
  const { executable, args, options } = spawnInvocation(ajs, [
    "project",
    "dev",
    "--watch",
  ]);
  const child = spawn(executable, args, {
    ...options,
    cwd: app,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWindows,
  });
  const output: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  try {
    await waitFor(() => fs.existsSync(builtEntry), child, "its first build");
    await delay(WATCH_SETTLE_MS);
    fs.appendFileSync(
      path.join(app, "src", "index.ts"),
      `\nexport const ${WATCH_MARKER} = true;\n`,
    );
    await waitFor(
      () =>
        fs.existsSync(builtEntry) &&
        readText(builtEntry).includes(WATCH_MARKER),
      child,
      "it rebuilt dist/index.js after src/index.ts changed",
    );
  } catch (error) {
    throw new Error(`${String(error)}\n${output.join("")}`);
  } finally {
    stopTree(child);
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(root, "dist", "index.js"))) {
    throw new Error("Missing dist; run pnpm build first.");
  }
  installPackedCli();
  const app = path.join(temp, "app");
  run(
    ajs,
    ["project", "init", "app", "--yes", "--pm", "pnpm", "--no-git-init"],
    temp,
  );
  run(ajs, ["project", "dev"], app);
  run(ajs, ["project", "build"], app);
  run(ajs, ["project", "start"], app);
  await verifyWatchReload(app);
  run(ajs, ["project", "modules", "list"], app);
  run(ajs, ["config", "show"], temp);
  run(
    ajs,
    ["config", "set", "git", "https://github.com/AntelopeJS/interfaces.git"],
    temp,
  );
  run(ajs, ["config", "get", "git"], temp);
  run(ajs, ["config", "reset", "--yes"], temp);
  const mod = path.join(temp, "mod");
  run(
    ajs,
    ["module", "init", "mod", "--yes", "--pm", "npm", "--no-git-init"],
    temp,
  );
  run(ajs, ["module", "test"], mod);
}

main()
  .then(() => {
    fs.rmSync(temp, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 500,
    });
  })
  .catch((error: unknown) => {
    console.error(error);
    console.error(`Smoke workspace kept at ${temp}`);
    process.exit(1);
  });
