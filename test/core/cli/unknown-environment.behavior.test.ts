import sinon from "sinon";
import { expect } from "chai";
import { readFileSync } from "node:fs";

import * as indexModule from "../../../src/index";
import * as logging from "../../../src/logging";
import { runCLI } from "../../../src/core/cli/index";
import * as cliUi from "../../../src/core/cli/cli-ui";
import { writeConfig } from "../../../src/core/cli/common";
import { ConfigLoader } from "../../../src/core/config";
import * as gitOps from "../../../src/core/cli/git-operations";
import { stripAnsi } from "../../../src/core/cli/logging-utils";
import * as versionCheck from "../../../src/core/cli/version-check";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";
import { findConfigPath } from "../../../src/core/config/config-paths";
import * as buildArtifactModule from "../../../src/core/build/build-artifact";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { USAGE_EXIT_CODE } from "../../../src/core/cli/exit-codes";
import {
  getProcessUi,
  runWithErrorBoundary,
} from "../../../src/core/cli/output";

const UNKNOWN_ENVIRONMENT = "staging";
const ACCEPTED_ENVIRONMENT = "PRODUCTION";

interface UnknownEnvironmentCase {
  name: string;
  args: string[];
}

const COMMANDS: UnknownEnvironmentCase[] = [
  { name: "project build", args: ["project", "build"] },
  { name: "project modules list", args: ["project", "modules", "list"] },
  {
    name: "project modules add",
    args: ["project", "modules", "add", "@antelopejs/api"],
  },
  {
    name: "project modules remove",
    args: ["project", "modules", "remove", "billing"],
  },
  { name: "project modules update", args: ["project", "modules", "update"] },
  { name: "project modules install", args: ["project", "modules", "install"] },
  {
    name: "project logging show",
    args: ["project", "logging", "show", "--json"],
  },
  {
    name: "project logging set",
    args: ["project", "logging", "set", "--enable"],
  },
];

async function runCommand(
  projectDir: string,
  args: string[],
): Promise<number | string | null | undefined> {
  const fullArgs = [...args, "--project", projectDir];
  process.argv = ["node", "ajs", ...fullArgs];
  await runWithErrorBoundary(() => runCLI(fullArgs));
  return process.exitCode;
}

function reportedLines(): string[] {
  const written = (process.stderr.write as sinon.SinonStub).args
    .map((args) => String(args[0]))
    .join("");
  return stripAnsi(written).split("\n");
}

describe("unknown --env", () => {
  const originalArgv = process.argv.slice();
  let projectDir: string;
  let configSource: string;
  let workStubs: sinon.SinonStub[];

  beforeEach(async () => {
    projectDir = makeTempDir();
    await writeConfig(projectDir, {
      name: "acme-shop",
      modules: { billing: "1.0.0" },
      environments: { production: {} },
    });
    configSource = readFileSync(
      await findConfigPath(projectDir, new NodeFileSystem()),
      "utf8",
    );
    sinon.stub(logging, "setupAntelopeProjectLogging");
    sinon.stub(versionCheck, "startUpdateCheck").returns(undefined);
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");
    sinon.stub(console, "log");
    sinon.stub(console, "error");
    sinon.stub(process.stderr, "write").returns(true);
    workStubs = [
      sinon.stub(indexModule, "build").resolves(),
      sinon.stub(ConfigLoader.prototype, "load").resolves(),
      sinon.stub(gitOps, "loadManifestFromGit").resolves(),
    ];
  });

  afterEach(() => {
    sinon.restore();
    process.argv = originalArgv.slice();
    process.exitCode = undefined;
    cleanupTempDir(projectDir);
  });

  async function run(
    args: string[],
  ): Promise<number | string | null | undefined> {
    return runCommand(projectDir, [...args, "--env", UNKNOWN_ENVIRONMENT]);
  }

  COMMANDS.forEach(({ name, args }) => {
    it(`${name} exits 2 before doing any work`, async () => {
      const code = await run(args);

      expect(code).to.equal(USAGE_EXIT_CODE);
      expect(reportedLines()).to.include.members([
        `${getProcessUi().symbols.levels.error} Unknown environment '${UNKNOWN_ENVIRONMENT}'`,
        "  Known environments: default, production",
      ]);
      expect(workStubs.some((stub) => stub.called)).to.equal(false);
      expect((console.log as sinon.SinonStub).called).to.equal(false);
      expect(
        readFileSync(
          await findConfigPath(projectDir, new NodeFileSystem()),
          "utf8",
        ),
      ).to.equal(configSource);
    });
  });

  it("names ANTELOPEJS_LAUNCH_ENV when it sets the unknown environment", async () => {
    sinon
      .stub(process, "env")
      .value({ ...process.env, ANTELOPEJS_LAUNCH_ENV: UNKNOWN_ENVIRONMENT });

    const code = await runCommand(projectDir, ["project", "build"]);

    expect(code).to.equal(USAGE_EXIT_CODE);
    expect(reportedLines()).to.include(
      `  ${getProcessUi().symbols.arrow} '${UNKNOWN_ENVIRONMENT}' is set by ANTELOPEJS_LAUNCH_ENV: change it (or pass --env) to one of them, or add an "environments.${UNKNOWN_ENVIRONMENT}" entry to the project configuration`,
    );
    expect(workStubs.some((stub) => stub.called)).to.equal(false);
  });
});

describe("--env without declared environments", () => {
  const originalArgv = process.argv.slice();
  let projectDir: string;
  let buildStub: sinon.SinonStub;

  beforeEach(async () => {
    projectDir = makeTempDir();
    await writeConfig(projectDir, { name: "acme-shop" });
    sinon.stub(logging, "setupAntelopeProjectLogging");
    sinon.stub(versionCheck, "startUpdateCheck").returns(undefined);
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
    sinon.stub(cliUi, "info");
    sinon.stub(console, "log");
    sinon.stub(process.stderr, "write").returns(true);
    sinon
      .stub(buildArtifactModule, "readBuildArtifact")
      .resolves({ modules: {} } as any);
    buildStub = sinon.stub(indexModule, "build").resolves();
  });

  afterEach(() => {
    sinon.restore();
    process.argv = originalArgv.slice();
    process.exitCode = undefined;
    cleanupTempDir(projectDir);
  });

  it("project build accepts any --env and builds it", async () => {
    const code = await runCommand(projectDir, [
      "project",
      "build",
      "--env",
      ACCEPTED_ENVIRONMENT,
    ]);

    expect(code).to.equal(undefined);
    expect(buildStub.firstCall.args[1]).to.equal(ACCEPTED_ENVIRONMENT);
  });

  it("project build accepts any ANTELOPEJS_LAUNCH_ENV and builds it", async () => {
    sinon
      .stub(process, "env")
      .value({ ...process.env, ANTELOPEJS_LAUNCH_ENV: ACCEPTED_ENVIRONMENT });

    const code = await runCommand(projectDir, ["project", "build"]);

    expect(code).to.equal(undefined);
    expect(buildStub.firstCall.args[1]).to.equal(ACCEPTED_ENVIRONMENT);
  });
});
