const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PUBLIC_ENTRY = "@antelopejs/core/cli";
const LOAD_BUDGET_MS = 15;
const LOAD_SAMPLE_COUNT = 7;
const EAGER_FORBIDDEN_MODULES = [
  /[\\/]node_modules[\\/]@antelopejs[\\/]interface-core[\\/]/,
  /[\\/]node_modules[\\/]commander[\\/]/,
  /[\\/]node_modules[\\/]@clack[\\/]/,
  /[\\/]core[\\/]cli[\\/]output[\\/](failures|translations)\.js$/,
  /[\\/]core[\\/]cli[\\/]command\.js$/,
];
const LOAD_TIME_PROBE = `
const start = process.hrtime.bigint();
require(${JSON.stringify(PUBLIC_ENTRY)});
process.stdout.write(String(Number(process.hrtime.bigint() - start) / 1e6));
`;
const LOADED_MODULES_PROBE = `
require(${JSON.stringify(PUBLIC_ENTRY)});
process.stdout.write(JSON.stringify(Object.keys(require.cache)));
`;

function runProbe(source) {
  return execFileSync(process.execPath, ["-e", source], {
    cwd: __dirname,
    encoding: "utf8",
  });
}

function memoryStream() {
  const chunks = [];
  return {
    isTTY: false,
    write: (chunk) => chunks.push(chunk),
    text: () => chunks.join(""),
  };
}

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

function verifyStaysLight() {
  const loaded = JSON.parse(runProbe(LOADED_MODULES_PROBE));
  const eager = loaded.filter((file) =>
    EAGER_FORBIDDEN_MODULES.some((pattern) => pattern.test(file)),
  );
  if (eager.length > 0) {
    throw new Error(`${PUBLIC_ENTRY} loaded eagerly:\n${eager.join("\n")}`);
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function verifyLoadBudget() {
  const samples = Array.from({ length: LOAD_SAMPLE_COUNT }, () =>
    Number(runProbe(LOAD_TIME_PROBE)),
  );
  const loadMs = median(samples);
  if (loadMs >= LOAD_BUDGET_MS) {
    throw new Error(
      `${PUBLIC_ENTRY} took ${loadMs.toFixed(1)} ms to load (budget ${LOAD_BUDGET_MS} ms)`,
    );
  }
}

async function main() {
  verifyResolution();
  verifyStaysLight();
  verifyLoadBudget();
  const cli = require(PUBLIC_ENTRY);
  verifyExitCodes(cli);
  verifyOutput(cli);
  verifyHelp(cli);
  await verifyErrorBoundary(cli);
  await verifyTranslateHook(cli);
  process.exitCode = 0;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
