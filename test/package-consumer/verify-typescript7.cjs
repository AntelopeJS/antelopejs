const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CONFIG_FILE = "antelope.config.ts";
const MODULE_KEY = "hello";
const SAVED_KEY = "saved";
const STARTED_FILE = "started.txt";
const MODULE_FILES = {
  "package.json": JSON.stringify({
    name: MODULE_KEY,
    version: "1.0.0",
    main: "dist/index.js",
    antelopeJs: {},
  }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      module: "commonjs",
      target: "es2022",
      outDir: "dist",
      rootDir: "src",
      strict: true,
      types: ["node"],
    },
    include: ["src"],
  }),
  "src/index.ts": [
    'import { writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "",
    "export function start(): void {",
    `  writeFileSync(join(__dirname, "..", "${STARTED_FILE}"), "started");`,
    "}",
    "",
  ].join("\n"),
};
const CONFIG_SOURCE = [
  'import { defineConfig } from "@antelopejs/interface-core/config";',
  "",
  "export default defineConfig({",
  '  name: "typescript7",',
  "});",
  "",
].join("\n");

const project = process.cwd();
const modulePath = path.join(project, "modules", MODULE_KEY);
const configPath = path.join(project, CONFIG_FILE);

function coreFolder() {
  return path.dirname(require.resolve("@antelopejs/core"));
}

function writeFixture() {
  fs.writeFileSync(configPath, CONFIG_SOURCE);
  for (const [file, content] of Object.entries(MODULE_FILES)) {
    const target = path.join(modulePath, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/** @param {string} home @param {string[]} args */
function runCli(home, args) {
  const cli = path.join(coreFolder(), "core", "cli", "index.js");
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      AJS_NO_UPDATE_CHECK: "1",
      HOME: home,
      USERPROFILE: home,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/** @param {string} home */
function listedModules(home) {
  /** @type {unknown} */
  const listing = JSON.parse(
    runCli(home, ["project", "modules", "list", "--json"]),
  );
  if (!Array.isArray(listing)) {
    throw new Error(`ajs project modules list printed ${String(listing)}`);
  }
  return listing.map((entry) => String(entry.name));
}

/**
 * @param {string[]} declared
 * @param {string} key
 * @param {boolean} expected
 * @param {string} step
 */
function expectDeclared(declared, key, expected, step) {
  if (declared.includes(key) !== expected) {
    throw new Error(
      `${step} left ${key} ${expected ? "missing from" : "in"} ${CONFIG_FILE}, which declares ${JSON.stringify(declared)}`,
    );
  }
}

async function verifyModuleLoadsAndEditsConfig() {
  const core = require("@antelopejs/core");
  const modules = require("@antelopejs/interface-core/modules");
  const manager = await core.launch(project);
  try {
    if (!fs.existsSync(path.join(modulePath, STARTED_FILE))) {
      throw new Error(`launch did not start ${MODULE_KEY}`);
    }
    await modules.SaveModuleDeclaration(SAVED_KEY, {
      source: { type: "local", path: `modules/${MODULE_KEY}` },
      disabled: true,
    });
    const saved = Object.keys(await modules.ListModuleDeclarations());
    expectDeclared(saved, SAVED_KEY, true, "SaveModuleDeclaration");
    await modules.RemoveModuleDeclaration(SAVED_KEY);
    const removed = Object.keys(await modules.ListModuleDeclarations());
    expectDeclared(removed, SAVED_KEY, false, "RemoveModuleDeclaration");
  } finally {
    await manager.stopAll();
    await manager.destroyAll();
  }
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ajs-typescript7-home-"));
  try {
    writeFixture();
    runCli(home, [
      "project",
      "modules",
      "add",
      `./modules/${MODULE_KEY}`,
      "--mode",
      "local",
    ]);
    const added = listedModules(home);
    expectDeclared(added, MODULE_KEY, true, "ajs project modules add");
    await verifyModuleLoadsAndEditsConfig();
    runCli(home, ["project", "modules", "remove", MODULE_KEY]);
    const removed = listedModules(home);
    expectDeclared(removed, MODULE_KEY, false, "ajs project modules remove");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

main().catch((/** @type {unknown} */ error) => {
  const detail = error instanceof Error ? (error.stack ?? error) : error;
  process.stderr.write(`${String(detail)}\n`);
  process.exitCode = 1;
});
