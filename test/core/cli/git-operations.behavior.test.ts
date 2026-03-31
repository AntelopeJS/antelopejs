import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { expect } from "chai";
import sinon from "sinon";
import * as command from "../../../src/core/cli/command";
import { cleanupTempDir, makeTempDir, writeJson } from "../../helpers/temp";

describe("Git operations behavior", () => {
  afterEach(() => {
    sinon.restore();
  });

  async function loadGitOpsWithHome(homeDir: string) {
    process.env.HOME = homeDir;
    const gitOpsPath = require.resolve("../../../src/core/cli/git-operations");
    const lockPath = require.resolve("../../../src/utils/lock");
    delete require.cache[gitOpsPath];
    delete require.cache[lockPath];
    return import("../../../src/core/cli/git-operations");
  }

  it("loads manifest and interface info from git cache", async () => {
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      const gitUrl = "https://example.com/repo.git";
      const folderName = gitUrl.replace(/[^a-zA-Z0-9_]/g, "_");
      const repoPath = path.join(homeDir, ".antelopejs", "cache", folderName);
      await fsPromises.mkdir(path.join(repoPath, "interfaces", "foo"), {
        recursive: true,
      });
      writeJson(path.join(repoPath, "manifest.json"), {
        interfaces: {},
        starredInterfaces: [],
        templates: [],
      });
      writeJson(path.join(repoPath, "interfaces", "foo", "manifest.json"), {
        description: "foo",
        package: "@antelopejs/foo",
        modules: [],
      });

      sinon
        .stub(command, "ExecuteCMD")
        .resolves({ code: 0, stdout: "", stderr: "" });

      const manifest = await gitOps.loadManifestFromGit(gitUrl);
      expect(manifest.templates).to.be.an("array");

      const info = await gitOps.loadInterfaceFromGit(gitUrl, "foo");
      expect(info?.name).to.equal("foo");

      const infos = await gitOps.loadInterfacesFromGit(gitUrl, [
        "foo",
        "missing",
      ]);
      expect(infos.foo).to.not.equal(undefined);
      expect(infos.missing).to.equal(undefined);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(homeDir);
    }
  });

  it("pulls when git cache already exists", async () => {
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      const gitUrl = "https://example.com/repo.git";
      const folderName = gitUrl.replace(/[^a-zA-Z0-9_]/g, "_");
      const repoPath = path.join(homeDir, ".antelopejs", "cache", folderName);
      await fsPromises.mkdir(repoPath, { recursive: true });
      writeJson(path.join(repoPath, "manifest.json"), {
        interfaces: {},
        starredInterfaces: [],
        templates: [],
      });

      const execStub = sinon
        .stub(command, "ExecuteCMD")
        .resolves({ code: 0, stdout: "", stderr: "" });

      await gitOps.loadManifestFromGit(gitUrl);

      expect(execStub.calledWith("git pull", { cwd: repoPath })).to.equal(true);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(homeDir);
    }
  });

  it("copies template using git commands", async () => {
    const moduleDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(moduleDir);
      const execStub = sinon
        .stub(command, "ExecuteCMD")
        .resolves({ code: 0, stdout: "", stderr: "" });

      await gitOps.copyTemplate(
        {
          name: "tpl",
          description: "tpl",
          repository: "https://example.com/repo.git",
          branch: "main",
        } as any,
        moduleDir,
      );

      expect(execStub.called).to.equal(true);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(moduleDir);
    }
  });

  it("throws when git clone fails during setup", async () => {
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      sinon
        .stub(command, "ExecuteCMD")
        .resolves({ code: 1, stdout: "", stderr: "fail" });

      let caught: unknown;
      try {
        await gitOps.loadManifestFromGit("https://example.com/repo.git");
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(Error);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(homeDir);
    }
  });

  it("throws when sparse-checkout setup fails", async () => {
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      const execStub = sinon.stub(command, "ExecuteCMD");
      execStub.onFirstCall().resolves({ code: 0, stdout: "", stderr: "" });
      execStub
        .onSecondCall()
        .resolves({ code: 1, stdout: "", stderr: "sparse fail" });

      let caught: unknown;
      try {
        await gitOps.loadManifestFromGit("https://example.com/repo.git");
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(Error);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(homeDir);
    }
  });

  it("throws when checkout fails", async () => {
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      const execStub = sinon.stub(command, "ExecuteCMD");
      execStub.onCall(0).resolves({ code: 0, stdout: "", stderr: "" });
      execStub.onCall(1).resolves({ code: 0, stdout: "", stderr: "" });
      execStub.onCall(2).resolves({ code: 1, stdout: "", stderr: "checkout" });

      let caught: unknown;
      try {
        await gitOps.loadManifestFromGit("https://example.com/repo.git");
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(Error);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(homeDir);
    }
  });
});
