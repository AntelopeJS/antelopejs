const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync, spawnSync } = require("node:child_process");

const HEAVY_PACKAGES = ["typescript", "@clack", "rxjs", "inly"];
const HEAVY_MODULE_PATTERN = new RegExp(
  `[\\\\/]node_modules[\\\\/](${HEAVY_PACKAGES.join("|")})[\\\\/]`,
);
const LOADED_MODULES_VARIABLE = "AJS_LOADED_MODULES_FILE";
const HELP_HEADER = "Usage: ajs";
const USAGE_EXIT_CODE = 2;
const PROMPT_LIBRARY = "@clack/prompts";

function cliEntry() {
  const main = require.resolve("@antelopejs/core");
  return path.join(path.dirname(main), "core", "cli", "index.js");
}

function writeRecorder(folder) {
  const recorder = path.join(folder, "record-modules.cjs");
  fs.writeFileSync(
    recorder,
    `process.on("exit", () => require("node:fs").writeFileSync(process.env.${LOADED_MODULES_VARIABLE}, JSON.stringify(Object.keys(require.cache))));`,
  );
  return recorder;
}

function runCli(args, home, extraArgs = []) {
  return execFileSync(process.execPath, [...extraArgs, cliEntry(), ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function verifyHelpStaysLight(folder) {
  const loadedModulesFile = path.join(folder, "loaded-modules.json");
  process.env[LOADED_MODULES_VARIABLE] = loadedModulesFile;
  const output = runCli(["--help"], folder, [
    "--require",
    writeRecorder(folder),
  ]);
  if (!output.includes(HELP_HEADER)) {
    throw new Error(`Unexpected ajs --help output:\n${output}`);
  }
  const loaded = JSON.parse(fs.readFileSync(loadedModulesFile, "utf8"));
  const heavy = loaded.filter((file) => HEAVY_MODULE_PATTERN.test(file));
  if (heavy.length > 0) {
    throw new Error(`ajs --help loaded heavy modules:\n${heavy.join("\n")}`);
  }
}

function verifyLazyActionResolves(folder) {
  const config = JSON.parse(runCli(["config", "show", "--json"], folder));
  if (typeof config.git !== "string") {
    throw new Error(
      `Unexpected ajs config show output: ${JSON.stringify(config)}`,
    );
  }
}

function verifyPromptLibraryLoads() {
  const coreFolder = path.dirname(require.resolve("@antelopejs/core"));
  const library = require(
    require.resolve(PROMPT_LIBRARY, { paths: [coreFolder] }),
  );
  if (typeof library.confirm !== "function") {
    throw new Error(`${PROMPT_LIBRARY} did not load with require()`);
  }
}

function verifyMissingAnswersExit(folder) {
  const project = path.join(folder, "demo");
  const result = spawnSync(
    process.execPath,
    [cliEntry(), "project", "init", project],
    {
      encoding: "utf8",
      env: { ...process.env, HOME: folder, USERPROFILE: folder },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== USAGE_EXIT_CODE || !result.stderr.includes("--name")) {
    throw new Error(
      `ajs project init without a terminal should exit ${USAGE_EXIT_CODE} naming its flags, got ${result.status}:\n${result.stderr}`,
    );
  }
  if (fs.existsSync(project)) {
    throw new Error("ajs project init wrote files it could not complete");
  }
}

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ajs-packed-cli-"));
try {
  verifyHelpStaysLight(folder);
  verifyLazyActionResolves(folder);
  verifyPromptLibraryLoads();
  verifyMissingAnswersExit(folder);
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
} finally {
  fs.rmSync(folder, { recursive: true, force: true });
}
