import path from "node:path";
import sinon from "sinon";
import { expect } from "chai";

import * as logging from "../../../../src/logging";
import { runCLI } from "../../../../src/core/cli/index";
import { writeConfig } from "../../../../src/core/cli/common";
import { runWithErrorBoundary } from "../../../../src/core/cli/output";
import {
  captureOutputAsync,
  type CapturedOutput,
} from "../../../helpers/capture-output";
import { cleanupTempDir, makeTempDir, writeJson } from "../../../helpers/temp";

interface DataCommandCase {
  name: string;
  args: (projectDir: string) => string[];
}

const UPDATE_NOTICE = "Update available";
const NEWER_CORE_VERSION = "999.0.0";
const JSON_DOCUMENT_LAYOUT = /^\S[\s\S]*\S\n$/;
const PROCESS_VARIABLES = ["HOME", "USERPROFILE", "CI", "AJS_NO_UPDATE_CHECK"];

const DATA_COMMANDS: DataCommandCase[] = [
  {
    name: "project modules list",
    args: (projectDir) => ["project", "modules", "list", "-p", projectDir],
  },
  {
    name: "project logging show",
    args: (projectDir) => ["project", "logging", "show", "-p", projectDir],
  },
  { name: "config show", args: () => ["config", "show"] },
  { name: "config get", args: () => ["config", "get", "git"] },
  { name: "plugins", args: () => ["plugins"] },
  { name: "plugins list", args: () => ["plugins", "list"] },
];

function snapshotVariables(): Record<string, string | undefined> {
  return Object.fromEntries(
    PROCESS_VARIABLES.map((name) => [name, process.env[name]]),
  );
}

function restoreVariables(snapshot: Record<string, string | undefined>): void {
  Object.entries(snapshot).forEach(([name, value]) => {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  });
}

function makeUpdateDue(home: string): void {
  writeJson(path.join(home, ".antelopejs", "update-check.json"), {
    checkedAt: Date.now(),
    latestVersion: NEWER_CORE_VERSION,
  });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CI;
  delete process.env.AJS_NO_UPDATE_CHECK;
}

describe("data commands with --json", () => {
  const originalArgv = process.argv.slice();
  const originalStderrTerminal = process.stderr.isTTY;
  let variables: Record<string, string | undefined>;
  let home: string;
  let projectDir: string;

  beforeEach(async () => {
    variables = snapshotVariables();
    home = makeTempDir();
    projectDir = makeTempDir();
    await writeConfig(projectDir, {
      name: "acme-shop",
      modules: {
        billing: { source: { type: "local", path: "modules/billing" } },
      },
    });
    makeUpdateDue(home);
    process.stderr.isTTY = true;
    sinon.stub(logging, "setupAntelopeProjectLogging");
  });

  afterEach(() => {
    sinon.restore();
    restoreVariables(variables);
    process.stderr.isTTY = originalStderrTerminal;
    process.argv = originalArgv.slice();
    process.exitCode = undefined;
    cleanupTempDir(home);
    cleanupTempDir(projectDir);
  });

  async function run(args: string[]): Promise<CapturedOutput> {
    process.argv = ["node", "ajs", ...args];
    return captureOutputAsync(() => runWithErrorBoundary(() => runCLI(args)));
  }

  it("prints the update notice on stderr when it is due and --json is absent", async () => {
    const output = await run(["config", "show"]);

    expect(output.stderr).to.contain(UPDATE_NOTICE);
    expect(output.stdout).to.not.contain(UPDATE_NOTICE);
  });

  DATA_COMMANDS.forEach(({ name, args }) => {
    it(`${name} --json writes only one JSON document on stdout`, async () => {
      const output = await run([...args(projectDir), "--json"]);

      expect(() => JSON.parse(output.stdout), output.stdout).to.not.throw();
      expect(output.stdout).to.match(JSON_DOCUMENT_LAYOUT);
      expect(output.stderr).to.not.contain(UPDATE_NOTICE);
      expect(process.exitCode ?? 0).to.equal(0);
    });
  });
});
