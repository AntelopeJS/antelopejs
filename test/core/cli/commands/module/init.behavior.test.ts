import sinon from "sinon";
import { expect } from "chai";
import inquirer from "inquirer";

import * as cliUi from "../../../../../src/core/cli/cli-ui";
import * as common from "../../../../../src/core/cli/common";
import * as command from "../../../../../src/core/cli/command";
import * as gitOps from "../../../../../src/core/cli/git-operations";
import { CliError } from "../../../../../src/core/cli/output";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";
import * as pkgManager from "../../../../../src/core/cli/package-manager";
import cmdModuleInit, {
  moduleInitCommand,
} from "../../../../../src/core/cli/commands/module/init";

describe("module init behavior", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("runs through module initialization flow", async () => {
    const moduleDir = makeTempDir();
    try {
      sinon
        .stub(common, "readUserConfig")
        .resolves({ git: common.DEFAULT_GIT_REPO });
      sinon.stub(common, "displayNonDefaultGitWarning").resolves();
      sinon.stub(gitOps, "loadManifestFromGit").resolves({
        templates: [
          {
            name: "basic",
            repository: "",
            branch: "",
          },
        ],
        interfaces: {},
        starredInterfaces: [],
      });
      sinon.stub(gitOps, "copyTemplate").resolves();
      sinon.stub(gitOps, "loadInterfacesFromGit").resolves({});

      const promptStub = sinon.stub(inquirer, "prompt");
      promptStub.onCall(0).resolves({ template: "basic" });
      promptStub.onCall(1).resolves({ packageManager: "npm" });
      promptStub.onCall(2).resolves({ initGit: false });

      sinon.stub(pkgManager, "savePackageManagerToPackageJson").returns();
      const getInstallCommandStub = sinon
        .stub(pkgManager, "getInstallCommand")
        .resolves("npm install");
      const execStub = sinon
        .stub(command, "ExecuteCMD")
        .resolves({ code: 0, stdout: "", stderr: "" });

      sinon.stub(cliUi.Spinner.prototype, "start").resolves();
      sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
      sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
      sinon.stub(cliUi.Spinner.prototype, "update").resolves();
      sinon.stub(cliUi, "displayBox").resolves();
      sinon.stub(cliUi, "info");
      sinon.stub(cliUi, "warning");
      sinon.stub(cliUi, "error");

      await moduleInitCommand(moduleDir, {}, false);

      expect(
        getInstallCommandStub.calledWith(moduleDir, false, undefined, "update"),
      ).to.equal(true);
      expect(execStub.calledWith("npm install", { cwd: moduleDir })).to.equal(
        true,
      );
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it("fails when directory is not empty", async () => {
    const moduleDir = makeTempDir();
    try {
      require("node:fs").writeFileSync(
        require("node:path").join(moduleDir, "file.txt"),
        "x",
      );
      sinon.stub(cliUi.Spinner.prototype, "start").resolves();
      sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
      sinon.stub(cliUi, "error");
      sinon.stub(cliUi, "warning");

      await moduleInitCommand(moduleDir, {}, false);

      expect(process.exitCode).to.equal(1);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it("refuses a non-empty directory when invoked through the CLI", async () => {
    const moduleDir = makeTempDir();
    try {
      require("node:fs").writeFileSync(
        require("node:path").join(moduleDir, "file.txt"),
        "x",
      );
      sinon.stub(cliUi.Spinner.prototype, "start").resolves();
      const failStub = sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
      const succeedStub = sinon
        .stub(cliUi.Spinner.prototype, "succeed")
        .resolves();
      sinon.stub(cliUi, "error");
      sinon.stub(console, "log");
      const manifestStub = sinon.stub(gitOps, "loadManifestFromGit");

      await cmdModuleInit().parseAsync(["node", "init", moduleDir]);

      expect(failStub.calledWith("Directory is not empty")).to.equal(true);
      expect(succeedStub.called).to.equal(false);
      expect(manifestStub.called).to.equal(false);
      expect(process.exitCode).to.equal(1);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it("handles missing template selection", async () => {
    const moduleDir = makeTempDir();
    try {
      sinon
        .stub(common, "readUserConfig")
        .resolves({ git: common.DEFAULT_GIT_REPO });
      sinon.stub(common, "displayNonDefaultGitWarning").resolves();
      sinon.stub(gitOps, "loadManifestFromGit").resolves({
        templates: [
          {
            name: "basic",
            repository: "",
            branch: "",
          },
        ],
        interfaces: {},
        starredInterfaces: [],
      });
      sinon.stub(gitOps, "copyTemplate").resolves();
      sinon.stub(gitOps, "loadInterfacesFromGit").resolves({});

      const promptStub = sinon.stub(inquirer, "prompt");
      promptStub.onCall(0).resolves({ template: "missing" });

      sinon.stub(cliUi.Spinner.prototype, "start").resolves();
      sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
      sinon.stub(cliUi, "error");
      sinon.stub(cliUi, "warning");

      await moduleInitCommand(moduleDir, {}, false);

      expect(process.exitCode).to.equal(1);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it("handles git init failure", async () => {
    const moduleDir = makeTempDir();
    try {
      sinon
        .stub(common, "readUserConfig")
        .resolves({ git: common.DEFAULT_GIT_REPO });
      sinon.stub(common, "displayNonDefaultGitWarning").resolves();
      sinon.stub(gitOps, "loadManifestFromGit").resolves({
        templates: [
          {
            name: "basic",
            repository: "",
            branch: "",
          },
        ],
        interfaces: {},
        starredInterfaces: [],
      });
      sinon.stub(gitOps, "copyTemplate").resolves();
      sinon.stub(gitOps, "loadInterfacesFromGit").resolves({});

      const promptStub = sinon.stub(inquirer, "prompt");
      promptStub.onCall(0).resolves({ template: "basic" });
      promptStub.onCall(1).resolves({ packageManager: "npm" });
      promptStub.onCall(2).resolves({ initGit: true });

      sinon.stub(pkgManager, "savePackageManagerToPackageJson").returns();
      sinon.stub(pkgManager, "getInstallCommand").resolves("npm install");
      sinon
        .stub(command, "ExecuteCMD")
        .resolves({ code: 0, stdout: "", stderr: "" });
      sinon
        .stub(require("node:child_process"), "execSync")
        .throws(new Error("git init failed"));

      const failStub = sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
      sinon.stub(cliUi.Spinner.prototype, "start").resolves();
      sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
      sinon.stub(cliUi, "displayBox").resolves();
      const warningStub = sinon.stub(cliUi, "warning");
      sinon.stub(cliUi, "info");
      sinon.stub(cliUi, "error");

      await moduleInitCommand(moduleDir, {}, false);

      expect(failStub.called).to.equal(true);
      expect(
        warningStub.calledWithMatch("Could not initialize git repository"),
      ).to.equal(true);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  async function rejectionOf(promise: Promise<unknown>): Promise<CliError> {
    try {
      await promise;
    } catch (err) {
      expect(err).to.be.instanceOf(CliError);
      return err as CliError;
    }
    throw new Error("Expected the module init to fail");
  }

  function stubTemplateRepository(failure: unknown): void {
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();
    sinon
      .stub(gitOps, "loadManifestFromGit")
      .callsFake(() => Promise.reject(failure));
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
    sinon.stub(cliUi, "warning");
  }

  it("explains a template repository that cannot be fetched", async () => {
    const moduleDir = makeTempDir();
    try {
      stubTemplateRepository("boom");

      const failure = await rejectionOf(moduleInitCommand(moduleDir, {}));

      expect(failure.problem.title).to.equal(
        `Could not fetch templates from ${common.DEFAULT_GIT_REPO}`,
      );
      expect(failure.problem.reason).to.equal(undefined);
      expect(failure.problem.fixes).to.deep.equal([
        "Check the URL passed with --git or saved with ajs config set git",
        "Or go back to the default repository: ajs config reset",
      ]);
      expect(failure.cause).to.equal("boom");
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it("translates a refused clone of the template repository", async () => {
    const moduleDir = makeTempDir();
    try {
      const url = "https://github.com/acme/missing.git";
      stubTemplateRepository(
        new command.ExecError({
          command: `git clone --depth 1 ${url} folder`,
          stdout: "",
          stderr:
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
          code: 128,
        }),
      );

      const failure = await rejectionOf(
        moduleInitCommand(moduleDir, { git: url }),
      );

      expect(failure.problem.title).to.equal(
        `Could not fetch templates from ${url}`,
      );
      expect(failure.problem.reason).to.equal(
        "The repository does not exist or requires authentication.",
      );
      expect(failure.problem.fixes).to.deep.equal([
        `Check the URL and your access to it: git ls-remote ${url}`,
        "Or go back to the default repository: ajs config reset",
      ]);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it("rethrows errors when called from a project init flow", async () => {
    const moduleDir = makeTempDir();
    try {
      sinon
        .stub(common, "readUserConfig")
        .resolves({ git: common.DEFAULT_GIT_REPO });
      sinon.stub(common, "displayNonDefaultGitWarning").resolves();
      sinon.stub(gitOps, "loadManifestFromGit").rejects(new Error("boom"));

      sinon.stub(cliUi.Spinner.prototype, "start").resolves();
      sinon.stub(cliUi.Spinner.prototype, "fail").resolves();

      let caught: unknown;
      try {
        await moduleInitCommand(moduleDir, {}, true);
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(Error);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it("propagates a cancelled template prompt without reporting a failure", async () => {
    const moduleDir = makeTempDir();
    try {
      sinon
        .stub(common, "readUserConfig")
        .resolves({ git: common.DEFAULT_GIT_REPO });
      sinon.stub(common, "displayNonDefaultGitWarning").resolves();
      sinon.stub(gitOps, "loadManifestFromGit").resolves({
        templates: [{ name: "basic" }],
        starredInterfaces: [],
        interfaces: {},
      } as any);
      const copyStub = sinon.stub(gitOps, "copyTemplate").resolves();
      const cancellation = { name: "ExitPromptError" };
      sinon.stub(inquirer, "prompt").rejects(cancellation);

      sinon.stub(cliUi.Spinner.prototype, "start").resolves();
      sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
      const failStub = sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
      const errorStub = sinon.stub(cliUi, "error");
      sinon.stub(cliUi, "info");
      sinon.stub(console, "log");

      let caught: unknown;
      try {
        await moduleInitCommand(moduleDir, {}, false);
      } catch (error) {
        caught = error;
      }

      expect(caught).to.equal(cancellation);
      expect(failStub.called).to.equal(false);
      expect(errorStub.called).to.equal(false);
      expect(copyStub.called).to.equal(false);
      expect(process.exitCode).to.equal(undefined);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });
});
