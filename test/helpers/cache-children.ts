import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const MODULES_SOURCE = path.join(REPO_ROOT, "src/core/modules");
const RUN_VARIABLE = "AJS_CACHE_CHILD_RUN";

/** How long a child of these tests may run before it is killed. */
export const CHILD_TIMEOUT_MS = 30_000;

const quoted = JSON.stringify;

/** A Node child running TypeScript sources of the core. */
export interface ChildRun {
  /** Resolves with what the child printed once it exits with code 0, rejects with it otherwise. */
  exited: Promise<string>;
  /** Resolves once the child has printed `text`. */
  printed(text: string): Promise<void>;
}

/**
 * Runs `script` in a Node child through ts-node, with `runJson` in the
 * environment variable the scripts below read.
 */
export function runInChild(script: string, runJson = "{}"): ChildRun {
  const child = spawn(
    process.execPath,
    ["-r", "ts-node/register", "-e", script],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TS_NODE_TRANSPILE_ONLY: "true",
        [RUN_VARIABLE]: runJson,
      },
      timeout: CHILD_TIMEOUT_MS,
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (output += String(chunk)));
  const exited = new Promise<string>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(output) : reject(new Error(output)),
    );
  });
  const printed = (text: string) =>
    new Promise<void>((resolve, reject) => {
      const check = () => output.includes(text) && resolve();
      child.stdout.on("data", check);
      exited.then(
        () => reject(new Error(`Exited without printing ${text}: ${output}`)),
        reject,
      );
      check();
    });
  return { exited, printed };
}

const RUN_PRELUDE = [
  `const fs = require("node:fs");`,
  `const path = require("node:path");`,
  `const run = JSON.parse(process.env.${RUN_VARIABLE});`,
  `const pause = () => new Promise((resolve) => setTimeout(resolve, 20));`,
  `const waitFor = async (file) => { while (file && !fs.existsSync(file)) await pause(); };`,
];

/**
 * Starts a child that loads the cache at `cachePath`, prints `ready`, waits
 * for `goFile`, then commits `entries` at `1.0.0` one after another.
 */
export function commitInChild(
  cachePath: string,
  entries: string[],
  goFile: string,
): ChildRun {
  return runInChild(
    [
      ...RUN_PRELUDE,
      `const { ModuleCache } = require(${quoted(MODULES_SOURCE)});`,
      `(async () => {`,
      `  const cache = new ModuleCache(run.cachePath);`,
      `  await cache.load();`,
      `  process.stdout.write("ready\\n");`,
      `  await waitFor(run.goFile);`,
      `  for (const entry of run.entries) await cache.commitVersion(entry, "1.0.0");`,
      `})().catch((error) => { console.error(error); process.exit(1); });`,
    ].join("\n"),
    JSON.stringify({ cachePath, entries, goFile }),
  );
}

/**
 * Starts a child that prunes the cache at `cachePath`, keeping nothing. Under
 * the prune lock, once it has read the leases, its keep rule prints `ready`
 * and waits for `goFile` before the prune goes on.
 */
export function pruneInChild(cachePath: string, goFile: string): ChildRun {
  return runInChild(
    [
      ...RUN_PRELUDE,
      `const { ModuleCache } = require(${quoted(MODULES_SOURCE)});`,
      `new ModuleCache(run.cachePath).prune(async () => {`,
      `  process.stdout.write("ready\\n");`,
      `  await waitFor(run.goFile);`,
      `  return () => false;`,
      `}).catch((error) => { console.error(error); process.exit(1); });`,
    ].join("\n"),
    JSON.stringify({ cachePath, goFile }),
  );
}

/** Creates `file`, empty, to open a gate a child waits for. */
export function openGate(file: string): void {
  writeFileSync(file, "");
}
