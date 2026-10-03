const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const HEAVY_PACKAGES = ["typescript", "inquirer", "rxjs", "inly"];
const HEAVY_MODULE_PATTERN = new RegExp(
  `[\\\\/]node_modules[\\\\/](${HEAVY_PACKAGES.join("|")})[\\\\/]`,
);
const LOADED_MODULES_VARIABLE = "AJS_LOADED_MODULES_FILE";
const HELP_HEADER = "Usage: ajs";

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

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ajs-packed-cli-"));
try {
  verifyHelpStaysLight(folder);
  verifyLazyActionResolves(folder);
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
} finally {
  fs.rmSync(folder, { recursive: true, force: true });
}
