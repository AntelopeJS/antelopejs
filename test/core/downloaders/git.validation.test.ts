import type { ModuleSourceGit } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import assert from "node:assert/strict";
import sinon from "sinon";
import { ExecError } from "../../../src/core/cli/command";
import { getProcessTasks } from "../../../src/core/cli/output";
import { registerGitDownloader } from "../../../src/core/downloaders/git";
import { DownloaderRegistry } from "../../../src/core/downloaders/registry";
import { ModuleCache } from "../../../src/core/module-cache";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

function sanitize(remote: string): string {
  return remote.replace(/[^a-zA-Z0-9_]/g, "_");
}
describe("GitDownloader", () => {
  it("keeps the full branch name when the default branch contains slashes", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const remote = "https://github.com/org/repo.git";
    const cacheKey = sanitize(remote);

    const exec = async (command: string, _options: { cwd?: string }) => {
      if (command.startsWith("git clone")) {
        await fs.writeFile(
          `/cache/${cacheKey}/package.json`,
          JSON.stringify({ name: "repo", version: "1.0.0" }),
        );
        return { stdout: "", stderr: "", code: 0 };
      }
      if (command.startsWith("git rev-parse")) {
        return { stdout: "abcdef", stderr: "", code: 0 };
      }
      if (command.startsWith("git symbolic-ref")) {
        return {
          stdout: "refs/remotes/origin/release/2.x\n",
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: "git",
      remote,
    };

    await registry.load("/project", cache, source);

    expect(cache.getVersion(cacheKey)).to.equal("git:release/2.x:abcdef");
  });

  it("rejects a remote containing shell metacharacters before running git", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const execCalls: string[] = [];
    const exec = async (command: string, _options: { cwd?: string }) => {
      execCalls.push(command);
      return { stdout: "", stderr: "", code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: "git",
      remote: "https://github.com/org/repo.git; touch /tmp/pwned",
      ignoreCache: true,
    };

    try {
      await registry.load("/project", cache, source);
      expect.fail("Expected unsafe remote to be rejected");
    } catch (err) {
      expect(String(err)).to.include("Unsafe characters");
    }
    expect(execCalls.some((call) => call.startsWith("git clone"))).to.equal(
      false,
    );
  });

  it("rejects a branch containing shell metacharacters", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const exec = async (_command: string, _options: { cwd?: string }) => {
      return { stdout: "", stderr: "", code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: "git",
      remote: "https://github.com/org/repo.git",
      branch: "main; rm -rf ~",
      ignoreCache: true,
    };

    try {
      await registry.load("/project", cache, source);
      expect.fail("Expected unsafe branch to be rejected");
    } catch (err) {
      expect(String(err)).to.include("Unsafe characters");
    }
  });
});

describe("GitDownloader", () => {
  it("throws when git clone fails", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const messageStub = sinon.stub(getProcessTasks().ui, "message");

    const exec = async (command: string, _options: { cwd?: string }) => {
      if (command.startsWith("git clone")) {
        return { stdout: "", stderr: "repository not found", code: 1 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: "git",
      remote: "https://github.com/org/missing.git",
      ignoreCache: true,
    };

    try {
      await registry.load("/project", cache, source);
      expect.fail("Expected clone failure");
    } catch (err) {
      expect(err).to.be.instanceOf(ExecError);
      assert.ok(err instanceof ExecError);
      expect(err.command).to.equal(
        "git clone https://github.com/org/missing.git https___github_com_org_missing_git",
      );
      assert.ok(err instanceof ExecError);
      expect(err.stderr).to.equal("repository not found");
      expect(messageStub.called).to.equal(false);
    } finally {
      messageStub.restore();
    }
  });

  it("uses main branch when cached and no branch is specified", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const remote = "https://github.com/org/repo.git";
    const cacheKey = sanitize(remote);
    await cache.getFolder(cacheKey, true, false);
    await fs.writeFile(
      `/cache/${cacheKey}/package.json`,
      JSON.stringify({ name: "repo", version: "1.0.0" }),
    );
    await fs.writeFile(`/cache/${cacheKey}/.git/HEAD`, "ref: refs/heads/main");
    cache.setVersion(cacheKey, "git:main:oldcommit");

    const execCalls: string[] = [];
    const exec = async (command: string, _options: { cwd?: string }) => {
      execCalls.push(command);

      if (command === "git fetch") {
        return { stdout: "", stderr: "", code: 0 };
      }
      if (command.startsWith("git symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main", stderr: "", code: 0 };
      }
      if (command.startsWith("git rev-parse origin/main")) {
        return { stdout: "oldcommit", stderr: "", code: 0 };
      }
      if (command.startsWith("git rev-parse HEAD")) {
        return { stdout: "oldcommit", stderr: "", code: 0 };
      }

      return { stdout: "", stderr: "", code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: "git",
      remote,
    };

    await registry.load("/project", cache, source);

    expect(execCalls).to.include("git symbolic-ref refs/remotes/origin/HEAD");
  });

  it("should throw when rev-parse fails", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const exec = async (command: string, _options: { cwd?: string }) => {
      if (command.startsWith("git clone")) {
        const parts = command.split(" ");
        const folderName = parts[parts.length - 1];
        const repoPath = `/cache/${folderName}`;
        await fs.writeFile(
          `${repoPath}/package.json`,
          JSON.stringify({ name: "repo", version: "1.0.0" }),
        );
        return { stdout: "", stderr: "", code: 0 };
      }
      if (command.startsWith("git rev-parse")) {
        return { stdout: "", stderr: "fail", code: 1 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: "git",
      remote: "https://github.com/org/repo.git",
      ignoreCache: true,
    };

    try {
      await registry.load("/project", cache, source);
      expect.fail("Expected failure");
    } catch (err) {
      expect(err).to.be.instanceOf(Error);
    }
  });
});

describe("GitDownloader", () => {
  it("throws when rev-parse command throws", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const messageStub = sinon.stub(getProcessTasks().ui, "message");

    const exec = async (command: string, _options: { cwd?: string }) => {
      if (command.startsWith("git clone")) {
        const parts = command.split(" ");
        const folderName = parts[parts.length - 1];
        const repoPath = `/cache/${folderName}`;
        await fs.writeFile(
          `${repoPath}/package.json`,
          JSON.stringify({ name: "repo", version: "1.0.0" }),
        );
        return { stdout: "", stderr: "", code: 0 };
      }
      if (command.startsWith("git rev-parse")) {
        throw new Error("command exploded");
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: "git",
      remote: "https://github.com/org/repo.git",
      ignoreCache: true,
    };

    try {
      await registry.load("/project", cache, source);
      expect.fail("Expected failure");
    } catch (err) {
      expect(String(err)).to.include("command exploded");
      expect(messageStub.calledWith("error")).to.equal(false);
    } finally {
      messageStub.restore();
    }
  });

  it("throws when install command fails with stdout only", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const exec = async (command: string, _options: { cwd?: string }) => {
      if (command.startsWith("git clone")) {
        const parts = command.split(" ");
        const folderName = parts[parts.length - 1];
        const repoPath = `/cache/${folderName}`;
        await fs.writeFile(
          `${repoPath}/package.json`,
          JSON.stringify({ name: "repo", version: "1.0.0" }),
        );
        return { stdout: "", stderr: "", code: 0 };
      }
      if (command.startsWith("git rev-parse")) {
        return { stdout: "abcdef", stderr: "", code: 0 };
      }
      if (command.startsWith("git symbolic-ref")) {
        return { stdout: "refs/remotes/origin/main", stderr: "", code: 0 };
      }
      if (command === "npm install") {
        return { stdout: "fail", stderr: "", code: 1 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: "git",
      remote: "https://github.com/org/repo.git",
      ignoreCache: true,
      installCommand: "npm install",
    };

    try {
      await registry.load("/project", cache, source);
      expect.fail("Expected failure");
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.ok(err.cause instanceof ExecError);
      const failure = err.cause;
      expect(failure.command).to.equal("npm install");
      expect(failure.stdout).to.equal("fail");
    }
  });
});
