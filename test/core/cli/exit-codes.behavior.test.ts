import { expect } from "chai";
import { existsSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import {
  gitOperationsModule as gitOps,
  readConfig,
  runCLI,
  versionCheckModule as versionCheck,
  writeConfig,
} from "../../../src/cli";
import {
  BUILD_MODULE_SET_CHANGED_EXIT_CODE,
  CANCELLED_EXIT_CODE,
  cliUiModule as cliUi,
  FAILURE_EXIT_CODE,
  runWithErrorBoundary,
  SUCCESS_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../../src/core/output";
import { projectLaunchModule as projectLaunch } from "../../../src/core/repl";
import { BuildModuleSetChangedError } from "../../../src/core/runtime";
import * as logging from "../../../src/logging";
import { captureOutputAsync } from "../../helpers/capture-output";
import { CANCEL, fakePrompts } from "../../helpers/fake-prompts";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

const INSTALLED_MODULE = "billing";

{
  let registerCLIExitCodeContract: (this: Mocha.Suite) => void;

  const initializeOriginalArgv = () => process.argv.slice();
  let originalArgv: ReturnType<typeof initializeOriginalArgv>;

  let projectDir: string;

  async function run(args: string[]): Promise<number | string | undefined> {
    process.argv = ["node", "ajs", ...args];
    await runWithErrorBoundary(() => runCLI(args));
    return process.exitCode ?? SUCCESS_EXIT_CODE;
  }

  async function configuredModules(): Promise<string[]> {
    const config = await readConfig(projectDir);
    return Object.keys(config?.modules ?? {});
  }

  const checkExits0WhenTheCommand: (this: Mocha.Suite) => void = function () {
    it("exits 0 when the command succeeds", async () => {
      const code = await run([
        "project",
        "modules",
        "remove",
        INSTALLED_MODULE,
        "--project",
        projectDir,
      ]);

      expect(code).to.equal(SUCCESS_EXIT_CODE);
      expect(await configuredModules()).to.deep.equal([]);
    });

    it("exits 1 when the command fails", async () => {
      const code = await run([
        "project",
        "modules",
        "remove",
        "nope",
        "--project",
        projectDir,
      ]);

      expect(code).to.equal(FAILURE_EXIT_CODE);
      expect(await configuredModules()).to.deep.equal([INSTALLED_MODULE]);
    });

    it("exits 0 with any --env when the configuration declares no environments", async () => {
      const code = await run([
        "project",
        "modules",
        "remove",
        INSTALLED_MODULE,
        "--project",
        projectDir,
        "--env",
        "PRODUCTION",
      ]);

      expect(code).to.equal(SUCCESS_EXIT_CODE);
      expect(await configuredModules()).to.deep.equal([]);
    });

    it("exits 0 with any ANTELOPEJS_LAUNCH_ENV when the configuration declares no environments", async () => {
      sinon
        .stub(process, "env")
        .value({ ...process.env, ANTELOPEJS_LAUNCH_ENV: "PRODUCTION" });

      const code = await run([
        "project",
        "modules",
        "remove",
        INSTALLED_MODULE,
        "--project",
        projectDir,
      ]);

      expect(code).to.equal(SUCCESS_EXIT_CODE);
      expect(await configuredModules()).to.deep.equal([]);
    });

    it("exits 2 when --env names an environment the configuration does not declare", async () => {
      await writeConfig(projectDir, {
        name: "exit-codes",
        environments: { production: {} },
      });

      const code = await run([
        "project",
        "modules",
        "list",
        "--project",
        projectDir,
        "--env",
        "staging",
      ]);

      expect(code).to.equal(USAGE_EXIT_CODE);
    });

    it("exits 2 when a required argument is missing", async () => {
      const code = await run([
        "project",
        "modules",
        "remove",
        "--project",
        projectDir,
      ]);

      expect(code).to.equal(USAGE_EXIT_CODE);
    });

    it("exits 2 on an unknown option", async () => {
      const code = await run(["config", "show", "--bogus"]);

      expect(code).to.equal(USAGE_EXIT_CODE);
    });

    it("exits 2 on an unknown option of the production start", async () => {
      const code = await run(["project", "start", "--bogus"]);

      expect(code).to.equal(USAGE_EXIT_CODE);
    });

    it("exits 0 when help is requested", async () => {
      const stdoutWrite = sinon.stub(process.stdout, "write").returns(true);

      const code = await run(["project", "modules", "--help"]).finally(() =>
        stdoutWrite.restore(),
      );

      expect(code).to.equal(SUCCESS_EXIT_CODE);
    });

    it("exits 2 on an unknown subcommand of a command group", async () => {
      const code = await run(["project", "bogus"]);

      expect(code).to.equal(USAGE_EXIT_CODE);
    });
  };

  const checkExits3WhenTheBuild: (this: Mocha.Suite) => void = function () {
    it("exits 3 when the build no longer matches the configured modules", async () => {
      sinon
        .stub(projectLaunch, "launchFromBuild")
        .rejects(new BuildModuleSetChangedError([INSTALLED_MODULE]));

      const code = await run([
        "project",
        "start",
        "--refresh-config",
        "--project",
        projectDir,
      ]);

      expect(code).to.equal(BUILD_MODULE_SET_CHANGED_EXIT_CODE);
    });

    it("exits 130 and writes nothing when a prompt is cancelled", async () => {
      const consoleError = sinon.stub(console, "error");
      fakePrompts({ answers: [CANCEL] });
      const newProject = path.join(projectDir, "new-project");

      const code = await run(["project", "init", newProject]);

      expect(code).to.equal(CANCELLED_EXIT_CODE);
      expect(consoleError.calledWith("Cancelled")).to.equal(true);
      expect(existsSync(newProject)).to.equal(false);
    });

    it("exits 2 naming the flags when a prompt cannot be answered", async () => {
      fakePrompts({ isInteractive: false });
      sinon.stub(gitOps, "loadManifestFromGit").resolves({
        templates: [{ name: "basic", repository: "", branch: "" }],
        interfaces: {},
        starredInterfaces: [],
      });
      const newProject = path.join(projectDir, "new-project");

      const code = await run(["project", "init", newProject]);

      expect(code).to.equal(USAGE_EXIT_CODE);
      expect(existsSync(newProject)).to.equal(false);
    });
  };

  registerCLIExitCodeContract = () => {
    originalArgv = initializeOriginalArgv();

    beforeEach(async () => {
      projectDir = makeTempDir();
      await writeConfig(projectDir, {
        name: "exit-codes",
        modules: {
          [INSTALLED_MODULE]: {
            source: { type: "package", package: "billing", version: "1.0.0" },
          },
        },
      });
      sinon.stub(logging, "setupAntelopeProjectLogging");
      sinon.stub(versionCheck, "startUpdateCheck").returns(undefined);
      sinon.stub(cliUi.Spinner.prototype, "start").resolves();
      sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
      sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
      sinon.stub(cliUi, "info");
      sinon.stub(cliUi, "success");
      sinon.stub(cliUi, "warning");
      sinon.stub(cliUi, "error");
      sinon.stub(console, "log");
      sinon.stub(process.stderr, "write").returns(true);
    });

    afterEach(() => {
      sinon.restore();
      process.argv = originalArgv.slice();
      process.exitCode = undefined;
      cleanupTempDir(projectDir);
    });

    describe("exits 0 when the command succeeds", function () {
      checkExits0WhenTheCommand.call(this);
    });

    describe("exits 3 when the build no longer matches the configured modules", function () {
      checkExits3WhenTheBuild.call(this);
    });
  };

  describe("CLI exit code contract", function () {
    registerCLIExitCodeContract.call(this);
  });
}

describe("CLI exit code without arguments", () => {
  const originalArgv = process.argv.slice();

  afterEach(() => {
    sinon.restore();
    process.argv = originalArgv.slice();
    process.exitCode = undefined;
  });

  it("exits 0 and prints the help on stdout", async () => {
    sinon.stub(logging, "setupAntelopeProjectLogging");
    sinon.stub(versionCheck, "startUpdateCheck").returns(undefined);
    process.argv = ["node", "ajs"];

    const output = await captureOutputAsync(() =>
      runWithErrorBoundary(() => runCLI([])),
    );

    expect(process.exitCode ?? SUCCESS_EXIT_CODE).to.equal(SUCCESS_EXIT_CODE);
    expect(output.stdout).to.contain("Usage: ajs [options] [command]");
    expect(output.stderr).to.equal("");
  });

  for (const group of [["project"], ["project", "modules"], ["config"]]) {
    it(`exits 0 and prints the help of ajs ${group.join(" ")} on stdout`, async () => {
      sinon.stub(logging, "setupAntelopeProjectLogging");
      sinon.stub(versionCheck, "startUpdateCheck").returns(undefined);
      process.argv = ["node", "ajs", ...group];

      const output = await captureOutputAsync(() =>
        runWithErrorBoundary(() => runCLI(group)),
      );

      expect(process.exitCode ?? SUCCESS_EXIT_CODE).to.equal(SUCCESS_EXIT_CODE);
      expect(output.stdout).to.contain(
        `Usage: ajs ${group.join(" ")} [options] [command]`,
      );
      expect(output.stderr).to.equal("");
    });
  }
});
