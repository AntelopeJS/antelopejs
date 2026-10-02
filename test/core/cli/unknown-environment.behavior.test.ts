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
import { NodeFileSystem } from "../../../src/core/filesystem";
import { USAGE_EXIT_CODE } from "../../../src/core/cli/exit-codes";

const UNKNOWN_ENVIRONMENT = "staging";

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
    const fullArgs = [
      ...args,
      "--project",
      projectDir,
      "--env",
      UNKNOWN_ENVIRONMENT,
    ];
    process.argv = ["node", "ajs", ...fullArgs];
    await runCLI(fullArgs);
    return process.exitCode;
  }

  function reportedLines(): string[] {
    const errorLines = (cliUi.error as sinon.SinonStub).args;
    const detailLines = (console.error as sinon.SinonStub).args;
    return [...errorLines, ...detailLines].map((args) =>
      stripAnsi(String(args[0])),
    );
  }

  COMMANDS.forEach(({ name, args }) => {
    it(`${name} exits 2 before doing any work`, async () => {
      const code = await run(args);

      expect(code).to.equal(USAGE_EXIT_CODE);
      expect(reportedLines()).to.include.members([
        `Unknown environment '${UNKNOWN_ENVIRONMENT}'`,
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
});
