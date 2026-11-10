const path = require("node:path");
const { execFileSync } = require("node:child_process");

/** @typedef {typeof import("../../src/core/cli/public")} PublicCli */

const PUBLIC_ENTRY = "@antelopejs/core/cli";
const EAGER_ALLOWED_FILES = new Map([
  [
    "@antelopejs/core",
    [
      "dist/core/cli/public.js",
      "dist/core/output/",
      "dist/core/filesystem/",
      "dist/utils/",
      "dist/types/",
    ],
  ],
  ["picocolors", [""]],
]);
const EAGER_FORBIDDEN_BUILTINS = ["NativeModule child_process"];
const LOADED_MODULES_PROBE = `
require(${JSON.stringify(PUBLIC_ENTRY)});
process.stdout.write(JSON.stringify({
  files: Object.keys(require.cache),
  builtins: process.moduleLoadList,
}));
`;

/** @param {string} source */
function runProbe(source) {
  return execFileSync(process.execPath, ["-e", source], {
    cwd: __dirname,
    encoding: "utf8",
  });
}

function memoryStream() {
  /** @type {string[]} */
  const chunks = [];
  return {
    isTTY: false,
    write: (/** @type {string} */ chunk) => chunks.push(chunk),
    text: () => chunks.join(""),
  };
}

/** @param {PublicCli} cli */
function memoryUi(cli) {
  const result = memoryStream();
  const feedback = memoryStream();
  const ui = cli.createUi({
    streams: { result, feedback },
    capabilities: {
      hasUnicode: false,
      colors: { result: false, feedback: false },
      terminals: { result: false, feedback: false },
    },
  });
  return { ui, result, feedback };
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} label
 */
function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function verifyResolution() {
  const resolved = require.resolve(PUBLIC_ENTRY);
  if (!resolved.endsWith(path.join("dist", "core", "cli", "public.js"))) {
    throw new Error(`${PUBLIC_ENTRY} resolved to ${resolved}`);
  }
  const manifest = require("@antelopejs/core/package.json");
  assertEqual(manifest.name, "@antelopejs/core", "package.json export");
}

/** @param {PublicCli} cli */
function verifyExitCodes(cli) {
  assertEqual(
    [
      cli.SUCCESS_EXIT_CODE,
      cli.FAILURE_EXIT_CODE,
      cli.USAGE_EXIT_CODE,
      cli.CANCELLED_EXIT_CODE,
    ],
    [0, 1, 2, 130],
    "exit codes",
  );
}

/** @param {PublicCli} cli */
function verifyOutput(cli) {
  const { ui, result, feedback } = memoryUi(cli);
  ui.message("success", "Built 2 modules");
  ui.table([{ name: "api" }], [{ header: "Name", value: (row) => row.name }]);
  ui.summary({ headline: "Built", durationMs: 2100 });
  assertEqual(
    feedback.text(),
    "v Built 2 modules\nBuilt - 2.1s\n",
    "feedback output",
  );
  assertEqual(result.text(), "api\n", "result output");
}

/** @param {PublicCli} cli */
async function verifyErrorBoundary(cli) {
  const { ui, feedback } = memoryUi(cli);
  await cli.runWithErrorBoundary(
    () =>
      Promise.reject(
        new cli.CliError({
          title: "Port 70000 is out of range",
          reason: "A port is a number from 1 to 65535.",
          fixes: ["Pass --port 3000"],
          exitCode: cli.USAGE_EXIT_CODE,
        }),
      ),
    { ui, verbose: false },
  );
  assertEqual(
    feedback.text(),
    "x Port 70000 is out of range\n  A port is a number from 1 to 65535.\n  > Pass --port 3000\n",
    "CliError report",
  );
  assertEqual(process.exitCode, cli.USAGE_EXIT_CODE, "CliError exit code");
}

/** @param {PublicCli} cli */
async function verifyTranslateHook(cli) {
  const { ui, feedback } = memoryUi(cli);
  await cli.runWithErrorBoundary(
    () => Promise.reject(new Error("fetch failed")),
    {
      ui,
      verbose: false,
      translate: () => ({ title: "Cannot reach the backend" }),
    },
  );
  assertEqual(
    feedback.text(),
    "x Cannot reach the backend\n",
    "translated failure",
  );
  assertEqual(process.exitCode, cli.FAILURE_EXIT_CODE, "failure exit code");
}

/** @param {PublicCli} cli */
function verifyHelp(cli) {
  assertEqual(cli.helpWidth({ isTTY: false }), 80, "help width in a pipe");
  assertEqual(
    cli.wrapText(`Run ${cli.unbreakable("ajs dms --help")} for details`, 10),
    ["Run", "ajs dms --help", "for", "details"],
    "wrapped help text",
  );
  assertEqual(
    cli.formatExamples([{ description: "Build", command: "ajs dms build" }]),
    "Examples:\n  # Build\n  $ ajs dms build",
    "help examples",
  );
}

/**
 * @param {unknown} value
 * @returns {value is { files: unknown[], builtins: unknown[] }}
 */
function isModuleList(value) {
  return (
    value instanceof Object &&
    Object.hasOwn(value, "files") &&
    Object.hasOwn(value, "builtins") &&
    Array.isArray(value.files) &&
    Array.isArray(value.builtins)
  );
}

function readLoadedModules() {
  /** @type {unknown} */
  const loaded = JSON.parse(runProbe(LOADED_MODULES_PROBE));
  if (!isModuleList(loaded)) {
    throw new Error(`${PUBLIC_ENTRY} probe printed an unexpected module list`);
  }
  return {
    files: loaded.files.map(String),
    builtins: loaded.builtins.map(String),
  };
}

/**
 * Splits a loaded file into the package it belongs to, read from its last
 * `node_modules` segment, and its path inside that package, or returns
 * `undefined` for a file outside `node_modules`.
 *
 * @param {string} file
 */
function packageFileOf(file) {
  const segments = file.split(/[\\/]node_modules[\\/]/);
  if (segments.length < 2) {
    return undefined;
  }
  const parts = segments[segments.length - 1].split(/[\\/]/);
  const nameLength = parts[0].startsWith("@") ? 2 : 1;
  return {
    name: parts.slice(0, nameLength).join("/"),
    path: parts.slice(nameLength).join("/"),
  };
}

/** @param {string} file */
function isAllowedEagerFile(file) {
  const packageFile = packageFileOf(file);
  if (packageFile === undefined) {
    return true;
  }
  const allowed = EAGER_ALLOWED_FILES.get(packageFile.name) ?? [];
  return allowed.some((prefix) => packageFile.path.startsWith(prefix));
}

/**
 * Fails when loading the public CLI entry loads a package file outside
 * `EAGER_ALLOWED_FILES`, such as the core runtime or a third-party package,
 * or the `child_process` builtin.
 */
function verifyStaysLight() {
  const loaded = readLoadedModules();
  const eager = [
    ...loaded.files.filter((file) => !isAllowedEagerFile(file)),
    ...loaded.builtins.filter((name) =>
      EAGER_FORBIDDEN_BUILTINS.includes(name),
    ),
  ];
  if (eager.length > 0) {
    throw new Error(`${PUBLIC_ENTRY} loaded eagerly:\n${eager.join("\n")}`);
  }
}

async function main() {
  verifyResolution();
  verifyStaysLight();
  const cli = require("@antelopejs/core/cli");
  verifyExitCodes(cli);
  verifyOutput(cli);
  verifyHelp(cli);
  await verifyErrorBoundary(cli);
  await verifyTranslateHook(cli);
  process.exitCode = 0;
}

main().catch((/** @type {unknown} */ error) => {
  const detail = error instanceof Error ? (error.stack ?? error) : error;
  process.stderr.write(`${String(detail)}\n`);
  process.exitCode = 1;
});
