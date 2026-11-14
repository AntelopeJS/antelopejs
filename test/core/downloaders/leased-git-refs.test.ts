import type { ModuleSourceGit } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  DownloaderRegistry,
  registerGitDownloader,
} from "../../../src/core/downloaders";
import { ModuleCache } from "../../../src/core/modules";
import {
  type IdleProcess,
  startIdleProcess,
  thisProcess,
  writeLease,
} from "../../helpers/cache-leases";
import { cleanupTempDir, makeTempDir, writeJson } from "../../helpers/temp";

const REMOTE = "https://github.com/org/repo.git";
const REPO_ENTRY = REMOTE.replace(/[^a-zA-Z0-9_]/g, "_");
const HEAD_COMMIT = "headcommit";

/**
 * Answers git as a clone checked out at {@link HEAD_COMMIT} on `main` would:
 * the tag `v1` and `origin/main` name that commit, `origin/feature` names
 * another one, and `origin/later` was never fetched.
 */
function cloneExec(commands: string[]) {
  return async (command: string) => {
    commands.push(command);
    if (command === "git rev-list -n 1 origin/feature") {
      return { stdout: "featurecommit", stderr: "", code: 0 };
    }
    if (command === "git rev-list -n 1 origin/later") {
      return { stdout: "", stderr: "unknown revision", code: 128 };
    }
    if (
      command.startsWith("git rev-parse") ||
      command.startsWith("git rev-list")
    ) {
      return { stdout: HEAD_COMMIT, stderr: "", code: 0 };
    }
    if (command.startsWith("git symbolic-ref")) {
      return { stdout: "refs/remotes/origin/main", stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  };
}

describe("The git downloader and a clone that another live run uses", () => {
  let root: string;
  let cachePath: string;
  let other: IdleProcess;
  let commands: string[];

  beforeEach(async () => {
    root = makeTempDir("ajs-leased-git-refs-");
    cachePath = path.join(root, "cache");
    commands = [];
    other = await startIdleProcess();
    const folder = path.join(cachePath, REPO_ENTRY);
    writeJson(path.join(folder, "package.json"), {
      name: "repo",
      version: "1.0.0",
      main: "index.js",
    });
    writeFileSync(path.join(folder, "index.js"), "module.exports = 1;\n");
    writeFileSync(path.join(folder, ".git"), "gitdir: elsewhere\n");
    writeLease(cachePath, "other.json", {
      ...thisProcess(),
      pid: other.pid,
      entries: [REPO_ENTRY],
    });
  });

  afterEach(async () => {
    await other.stop();
    cleanupTempDir(root);
  });

  const lease = () => path.join(cachePath, ".leases", "other.json");

  async function loadGit(options: Partial<ModuleSourceGit>) {
    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { exec: cloneExec(commands) });
    const cache = new ModuleCache(cachePath);
    await cache.load();
    const source: ModuleSourceGit = { type: "git", remote: REMOTE, ...options };
    const [loaded] = await registry.load(root, cache, source);
    return loaded;
  }

  function changedTheClone(): boolean {
    return commands.some((command) =>
      ["clone", "checkout", "fetch", "reset"].some((verb) =>
        command.startsWith(`git ${verb}`),
      ),
    );
  }

  it("keeps the clone when the commit it asks for is a tag naming the checked-out commit", async () => {
    const loaded = await loadGit({ commit: "v1", ignoreCache: true });

    expect(loaded.folder).to.equal(path.join(cachePath, REPO_ENTRY));
    expect(changedTheClone()).to.equal(false);
  });

  it("refuses the clone when it asks for another branch, naming the lease", async () => {
    await assert.rejects(
      loadGit({ branch: "feature", ignoreCache: true }),
      (error: Error) =>
        [lease(), "feature"].every((part) => error.message.includes(part)),
    );

    expect(changedTheClone()).to.equal(false);
  });

  it("refuses the clone when it asks for a branch the clone never fetched, naming the lease", async () => {
    await assert.rejects(
      loadGit({ branch: "later", ignoreCache: true }),
      (error: Error) =>
        [lease(), "later"].every((part) => error.message.includes(part)),
    );

    expect(changedTheClone()).to.equal(false);
  });

  it("neither fetches nor switches a listed clone that another run uses, and refuses another branch", async () => {
    writeJson(path.join(cachePath, "manifest.json"), {
      [REPO_ENTRY]: `git:main:${HEAD_COMMIT}`,
    });

    await assert.rejects(loadGit({ branch: "feature" }), (error: Error) =>
      error.message.includes(lease()),
    );
    expect(changedTheClone()).to.equal(false);

    commands.length = 0;
    const loaded = await loadGit({});
    expect(loaded.folder).to.equal(path.join(cachePath, REPO_ENTRY));
    expect(changedTheClone()).to.equal(false);
  });
});
