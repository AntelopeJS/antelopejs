import { expect } from "chai";
import inquirer from "inquirer";
import sinon from "sinon";
import * as cliUi from "../../../../../src/core/cli/cli-ui";
import * as command from "../../../../../src/core/cli/command";
import { moduleInitCommand } from "../../../../../src/core/cli/commands/module/init";
import * as common from "../../../../../src/core/cli/common";
import * as gitOps from "../../../../../src/core/cli/git-operations";
import * as pkgManager from "../../../../../src/core/cli/package-manager";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";

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
            description: "basic",
            repository: "",
            branch: "",
          },
        ],
        starredInterfaces: [],
      });
      sinon.stub(gitOps, "copyTemplate").resolves();

      const promptStub = sinon.stub(inquirer, "prompt");
      promptStub.onCall(0).resolves({ template: "basic" });
      promptStub.onCall(1).resolves({ packageManager: "npm" });
      promptStub.onCall(2).resolves({ initGit: false });

      sinon.stub(pkgManager, "savePackageManagerToPackageJson").returns();
      sinon.stub(pkgManager, "getInstallCommand").resolves("npm install");
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
            description: "basic",
            repository: "",
            branch: "",
          },
        ],
        starredInterfaces: [],
      });
      sinon.stub(gitOps, "copyTemplate").resolves();

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
            description: "basic",
            repository: "",
            branch: "",
          },
        ],
        starredInterfaces: [],
      });
      sinon.stub(gitOps, "copyTemplate").resolves();

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

  it("reports non-error failures gracefully", async () => {
    const moduleDir = makeTempDir();
    try {
      sinon
        .stub(common, "readUserConfig")
        .resolves({ git: common.DEFAULT_GIT_REPO });
      sinon.stub(common, "displayNonDefaultGitWarning").resolves();
      sinon
        .stub(gitOps, "loadManifestFromGit")
        .callsFake(() => Promise.reject("boom"));

      sinon.stub(cliUi.Spinner.prototype, "start").resolves();
      sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
      const errorStub = sinon.stub(cliUi, "error");
      sinon.stub(cliUi, "warning");

      await moduleInitCommand(moduleDir, {}, false);

      expect(errorStub.called).to.equal(true);
      expect(String(errorStub.firstCall.args[0])).to.include("Unknown error");
      expect(process.exitCode).to.equal(1);
    } finally {
      cleanupTempDir(moduleDir);
    }
  });

  it("reports error failures with the error message", async () => {
    const moduleDir = makeTempDir();
    try {
      sinon
        .stub(common, "readUserConfig")
        .resolves({ git: common.DEFAULT_GIT_REPO });
      sinon.stub(common, "displayNonDefaultGitWarning").resolves();
      sinon.stub(gitOps, "loadManifestFromGit").rejects(new Error("boom"));

      sinon.stub(cliUi.Spinner.prototype, "start").resolves();
      sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
      const errorStub = sinon.stub(cliUi, "error");
      sinon.stub(cliUi, "warning");

      await moduleInitCommand(moduleDir, {}, false);

      expect(errorStub.calledWithMatch(sinon.match.instanceOf(Error))).to.equal(
        true,
      );
      expect(process.exitCode).to.equal(1);
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
});
