import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import type { ModuleLockMode } from "../../src/core/modules";

const REPO_ROOT = path.resolve(__dirname, "../..");
const MODULES_SOURCE = path.join(REPO_ROOT, "src/core/modules");
const DOWNLOADERS_SOURCE = path.join(REPO_ROOT, "src/core/downloaders");
const RUN_VARIABLE = "AJS_CACHE_CHILD_RUN";

/**
 * How long a child of these tests may run once it has loaded its script,
 * before it is killed. Its boot through ts-node, which a loaded host slows
 * down without bound, is not counted.
 */
const CHILD_TIMEOUT_MS = 30_000;

const BOOTED = "booted";

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
    [
      "-r",
      "ts-node/register",
      "-e",
      `${script}\nprocess.send(${quoted(BOOTED)}, () => process.disconnect());`,
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TS_NODE_TRANSPILE_ONLY: "true",
        [RUN_VARIABLE]: runJson,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const { stdout, stderr } = child;
  if (stdout === null || stderr === null) {
    throw new Error("The child was spawned without stdout and stderr pipes");
  }
  let output = "";
  stdout.on("data", (chunk) => (output += String(chunk)));
  stderr.on("data", (chunk) => (output += String(chunk)));
  let deadline: NodeJS.Timeout | undefined;
  child.once("message", () => {
    deadline = setTimeout(() => child.kill(), CHILD_TIMEOUT_MS);
  });
  const exited = new Promise<string>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(deadline);
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(output));
      }
    });
  });
  const printed = (text: string) =>
    new Promise<void>((resolve, reject) => {
      const check = () => output.includes(text) && resolve();
      stdout.on("data", check);
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

/** Where the package double installs and logs, and what one child run loads. */
export interface PackageRun {
  cachePath: string;
  project: string;
  /** A folder for the temporary folders of the download. */
  tempRoot: string;
  /** A file the `npm pack` double appends the pid of the child to. */
  packLog: string;
  mode?: ModuleLockMode;
  ignoreCache?: boolean;
  /**
   * A file the child waits for once it has loaded the core, before it loads
   * the cache: a child started beside another boots at the same time as that
   * one, yet loads after it.
   */
  startGate?: string;
  /** A file the install double waits for after printing `installing`. */
  installGate?: string;
  /** A file the child waits for after printing `loaded`, so that its lease lives until then. */
  exitGate?: string;
}

/** The lockfile the install double writes in the folder it installs. */
export const INSTALLED_LOCKFILE = "package-lock.json";

/**
 * Starts a child that loads `pkg@1.0.0` into the cache through a
 * `DownloaderRegistry` with the package downloader, whose `npm pack`, extract
 * and install are doubles: the pack appends its pid to `packLog`, and the
 * install writes `node_modules` and a lockfile naming its pid. It prints
 * `loading`, then `loaded <folder>` once the module is loaded.
 */
export function loadPackageInChild(run: PackageRun): ChildRun {
  return runInChild(
    [
      ...RUN_PRELUDE,
      `const { DownloaderRegistry, registerPackageDownloader } = require(${quoted(DOWNLOADERS_SOURCE)});`,
      `const { ModuleCache, ModuleLockStore } = require(${quoted(MODULES_SOURCE)});`,
      `const exec = async (command, { cwd }) => {`,
      `  if (command.startsWith("npm pack")) { fs.appendFileSync(run.packLog, process.pid + "\\n"); return { stdout: "pkg-1.0.0.tgz", stderr: "", code: 0 }; }`,
      `  process.stdout.write("installing\\n");`,
      `  await waitFor(run.installGate);`,
      `  fs.mkdirSync(path.join(cwd, "node_modules", "dep"), { recursive: true });`,
      `  fs.writeFileSync(path.join(cwd, "node_modules", "dep", "package.json"), "{}");`,
      `  fs.writeFileSync(path.join(cwd, ${quoted(INSTALLED_LOCKFILE)}), "installed by " + process.pid);`,
      `  return { stdout: "", stderr: "", code: 0 };`,
      `};`,
      `const extract = async (_from, to) => {`,
      `  fs.mkdirSync(path.join(to, "package"), { recursive: true });`,
      `  fs.writeFileSync(path.join(to, "package", "package.json"), JSON.stringify({ name: "pkg", version: "1.0.0", main: "index.js", dependencies: { dep: "^1.0.0" } }));`,
      `  fs.writeFileSync(path.join(to, "package", "index.js"), "module.exports = " + process.pid + ";\\n");`,
      `};`,
      `const registry = new DownloaderRegistry();`,
      `registerPackageDownloader(registry, {`,
      `  exec, extract,`,
      `  getInstallCommand: async () => "install",`,
      `  getTemp: () => fs.promises.mkdtemp(path.join(run.tempRoot, "pack-")),`,
      `  lock: run.mode ? { store: new ModuleLockStore(run.project), mode: run.mode } : undefined,`,
      `});`,
      `(async () => {`,
      `  await waitFor(run.startGate);`,
      `  const cache = new ModuleCache(run.cachePath);`,
      `  await cache.load();`,
      `  process.stdout.write("loading\\n");`,
      `  const [loaded] = await registry.load(run.project, cache, { type: "package", package: "pkg", version: "1.0.0", id: "pkg", ignoreCache: run.ignoreCache });`,
      `  process.stdout.write("loaded " + loaded.folder + "\\n");`,
      `  await waitFor(run.exitGate);`,
      `})().catch((error) => { console.error(error); process.exit(1); });`,
    ].join("\n"),
    JSON.stringify(run),
  );
}

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
