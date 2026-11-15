import { expect } from "chai";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import {
  commandsModuleTestCommand as cmdTest,
  commonModule as common,
} from "../../../../../src/cli";
import {
  CliError,
  formatUsageErrors,
  getProcessUi,
} from "../../../../../src/core/output";
import { testModuleModule } from "../../../../../src/core/test";
import {
  cleanupTempDir,
  makeTempDir,
  writeJson,
} from "../../../../helpers/temp";
import { expectInstanceOf, rejectionOf } from "../../fixtures";

const CHILD_TIMEOUT_MS = 60000;
const CHILD_KILL_MS = 50000;
const SLOW_HOOK_MS = 2500;
const RAISED_TIMEOUT = "10000";
const REPORT_PREFIX = "REPORT ";
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const CHILD_SCRIPT = `
const { default: command } = require("./src/cli/commands/module/test");
command().parseAsync(["node", "test", ...process.argv.slice(1)]).then(
  () => console.log("${REPORT_PREFIX}exit " + (process.exitCode ?? 0)),
  (error) => console.log("${REPORT_PREFIX}error " + error.message),
);
`;

interface ChildRun {
  report: string;
  output: string;
}

function writeSlowHookModule(folder: string): void {
  writeJson(path.join(folder, "package.json"), {
    name: "slow-hook",
    version: "1.0.0",
    antelopeJs: { test: "antelope.test.js" },
  });
  writeFileSync(
    path.join(folder, "antelope.test.js"),
    'module.exports = { name: "slow-hook", modules: {}, test: { folder: "test" } };\n',
  );
  mkdirSync(path.join(folder, "test"));
  writeFileSync(
    path.join(folder, "test", "slow.test.js"),
    `describe("slow hook", () => { before((done) => { setTimeout(done, ${SLOW_HOOK_MS}); }); it("runs after the hook", () => {}); });\n`,
  );
}

function runModuleTest(args: string[]): Promise<ChildRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["-r", "ts-node/register", "-e", CHILD_SCRIPT, ...args],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "true" },
        timeout: CHILD_KILL_MS,
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", reject);
    child.on("close", () => {
      const line = output
        .split("\n")
        .find((entry) => entry.startsWith(REPORT_PREFIX));
      if (line === undefined) {
        reject(new Error(`The child printed no report:\n${output}`));
        return;
      }
      resolve({ report: line.slice(REPORT_PREFIX.length).trim(), output });
    });
  });
}

describe("module test --timeout", () => {
  let folder: string;

  beforeEach(() => {
    folder = makeTempDir("ajs-module-test-timeout-");
    writeSlowHookModule(folder);
  });

  afterEach(() => {
    cleanupTempDir(folder);
    sinon.restore();
  });

  it("fails a hook slower than mocha's 2000 ms default without the flag", async function () {
    this.timeout(CHILD_TIMEOUT_MS);

    const run = await runModuleTest([folder]);

    expect(run.report).to.equal("exit 1");
    expect(run.output).to.include("Timeout of 2000ms exceeded");
  });

  it("passes the same hook when the flag raises the timeout", async function () {
    this.timeout(CHILD_TIMEOUT_MS);

    const run = await runModuleTest([folder, "--timeout", RAISED_TIMEOUT]);

    expect(run.report, run.output).to.equal("exit 0");
    expect(run.output).to.include("1 passing");
  });

  it("forwards the timeout to TestModule", async () => {
    sinon.stub(common, "readModuleManifest").resolves({
      name: "modA",
      version: "1.0.0",
      antelopeJs: { test: "antelope.test.ts" },
    });
    sinon.stub(getProcessUi(), "message");
    const testStub = sinon.stub(testModuleModule, "TestModule").resolves(0);

    await cmdTest().parseAsync(["node", "test", folder, "--timeout", "5000"]);

    expect(testStub.firstCall.args[2]).to.equal(5000);
  });

  for (const value of [
    "0",
    "-1",
    "1.5",
    "abc",
    "2e3",
    "99999999999999999999",
  ]) {
    it(`stops on --timeout=${value} with an error naming the flag`, async () => {
      const testStub = sinon.stub(testModuleModule, "TestModule").resolves(0);
      const command = cmdTest();
      formatUsageErrors(command);

      const failure = await rejectionOf(
        command.parseAsync(["node", "test", folder, `--timeout=${value}`]),
      );

      expectInstanceOf(failure, CliError);
      expect(failure.problem.title).to.equal(
        `Option '--timeout <ms>' argument '${value}' is invalid. It must be a positive whole number of milliseconds.`,
      );
      expect(testStub.called).to.equal(false);
    });
  }
});
