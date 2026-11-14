import { Logging } from "@antelopejs/interface-core/logging";
import { expect } from "chai";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as sinon from "sinon";

import {
  DownloaderRegistry,
  registerGitDownloader,
  registerPackageDownloader,
} from "../../../src/core/downloaders";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { ModuleCache, ModuleLockStore } from "../../../src/core/modules";
import {
  type IdleProcess,
  manifestKeys,
  startIdleProcess,
  thisProcess,
  writeLease,
} from "../../helpers/cache-leases";
import {
  cleanupTempDir,
  makeTempDir,
  readText,
  writeJson,
} from "../../helpers/temp";

const REMOTE = "https://github.com/org/repo.git";
const REPO_ENTRY = REMOTE.replace(/[^a-zA-Z0-9_]/g, "_");
const SEEDED_INDEX = "module.exports = 'seeded';\n";

interface Recorded {
  commands: string[];
}

function recordingExec(recorded: Recorded) {
  return async (command: string) => {
    recorded.commands.push(command);
    if (command.startsWith("git rev-parse")) {
      return { stdout: "headcommit", stderr: "", code: 0 };
    }
    if (command.startsWith("git symbolic-ref")) {
      return { stdout: "refs/remotes/origin/main", stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  };
}

/** Seeds the folder of `entry` with a package that declares one dependency, installed or not. */
function seedPackage(folder: string, installed: boolean): void {
  writeJson(path.join(folder, "package.json"), {
    name: "repo",
    version: "1.0.0",
    main: "index.js",
    dependencies: { dep: "^1.0.0" },
  });
  writeFileSync(path.join(folder, "index.js"), SEEDED_INDEX);
  if (installed) {
    mkdirSync(path.join(folder, "node_modules", "dep"), { recursive: true });
  }
}

describe("Downloaders and a folder that another live run leases", () => {
  let root: string;
  let cachePath: string;
  let other: IdleProcess;
  let recorded: Recorded;

  beforeEach(async () => {
    root = makeTempDir("ajs-leased-folders-");
    cachePath = path.join(root, "cache");
    recorded = { commands: [] };
    other = await startIdleProcess();
  });

  afterEach(async () => {
    sinon.restore();
    await other.stop();
    cleanupTempDir(root);
  });

  function leaseToOther(entry: string): string {
    writeLease(cachePath, "other.json", {
      ...thisProcess(),
      pid: other.pid,
      entries: [entry],
    });
    return path.join(cachePath, ".leases", "other.json");
  }

  async function loadGit(ignoreCache: boolean) {
    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { exec: recordingExec(recorded) });
    const cache = new ModuleCache(cachePath);
    await cache.load();
    const [loaded] = await registry.load(root, cache, {
      type: "git",
      remote: REMOTE,
      ignoreCache,
    });
    return loaded;
  }

  function seedRepo(): void {
    const folder = path.join(cachePath, REPO_ENTRY);
    seedPackage(folder, true);
    writeFileSync(path.join(folder, ".git"), "gitdir: elsewhere\n");
  }

  it("keeps a cloned repository that another run uses when its source ignores the cache, and says so", async () => {
    const info = sinon.stub(Logging.Channel.prototype, "Info");
    seedRepo();
    writeJson(path.join(cachePath, "manifest.json"), {
      [REPO_ENTRY]: "git:main:headcommit",
    });
    leaseToOther(REPO_ENTRY);

    const loaded = await loadGit(true);

    expect(loaded.folder).to.equal(path.join(cachePath, REPO_ENTRY));
    expect(readText(path.join(loaded.folder, "index.js"))).to.equal(
      SEEDED_INDEX,
    );
    expect(
      recorded.commands.some((command) => command.includes("clone")),
    ).to.equal(false);
    expect(manifestKeys(cachePath)).to.deep.equal([REPO_ENTRY]);
    expect(info.args.map(([message]) => String(message)).join("\n")).to.include(
      "other.json",
    );
  });

  it("lists again a cloned repository that another run uses when the manifest lost it", async () => {
    seedRepo();
    leaseToOther(REPO_ENTRY);

    await loadGit(false);

    expect(
      recorded.commands.some((command) => command.includes("clone")),
    ).to.equal(false);
    expect(
      JSON.parse(readText(path.join(cachePath, "manifest.json"))),
    ).to.deep.equal({ [REPO_ENTRY]: "git:main:headcommit" });
  });

  it("refuses to replace a half-installed package folder that another run leases, naming its lease", async () => {
    const entry = "pkg@1.0.0";
    seedPackage(path.join(cachePath, entry), false);
    const lease = leaseToOther(entry);
    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, {
      exec: async (command) => {
        recorded.commands.push(command);
        return { stdout: "pkg-1.0.0.tgz", stderr: "", code: 0 };
      },
      extract: async (_from, to) =>
        seedPackage(path.join(to, "package"), false),
      getInstallCommand: async () => "install",
      getTemp: async () => mkdtempSync(path.join(root, "pack-")),
    });
    const cache = new ModuleCache(cachePath);
    await cache.load();

    await assert.rejects(
      registry.load(root, cache, {
        type: "package",
        package: "pkg",
        version: "1.0.0",
      }),
      (error: Error) => error.message.includes(lease),
    );

    expect(readText(path.join(cachePath, entry, "index.js"))).to.equal(
      SEEDED_INDEX,
    );
  });
});

describe("A frozen install and a folder that another live run uses", () => {
  let root: string;
  let cachePath: string;
  let other: IdleProcess;
  let recorded: Recorded;

  beforeEach(async () => {
    root = makeTempDir("ajs-frozen-in-use-");
    cachePath = path.join(root, "cache");
    recorded = { commands: [] };
    other = await startIdleProcess();
  });

  afterEach(async () => {
    await other.stop();
    cleanupTempDir(root);
  });

  function writeOtherLease(entry: string): string {
    writeLease(cachePath, "other.json", {
      ...thisProcess(),
      pid: other.pid,
      entries: [entry],
    });
    return path.join(cachePath, ".leases", "other.json");
  }

  it("refuses, in frozen mode, a folder that another run uses when it was installed from another lockfile", async () => {
    const entry = "pkg@1.0.0";
    const folder = path.join(cachePath, entry);
    seedPackage(folder, true);
    writeFileSync(path.join(folder, "pnpm-lock.yaml"), "installed: other\n");
    const lease = writeOtherLease(entry);
    const store = new ModuleLockStore(root, new NodeFileSystem());
    await store.write({
      package: "pkg",
      version: "1.0.0",
      lockfile: "pnpm-lock.yaml",
      content: "installed: locked\n",
    });
    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, {
      exec: async (command) => {
        recorded.commands.push(command);
        return { stdout: "pkg-1.0.0.tgz", stderr: "", code: 0 };
      },
      lock: { store, mode: "frozen" },
    });
    const cache = new ModuleCache(cachePath);
    await cache.load();

    await assert.rejects(
      registry.load(root, cache, {
        type: "package",
        package: "pkg",
        version: "1.0.0",
      }),
      (error: Error) =>
        [lease, "frozen", "pnpm-lock.yaml"].every((part) =>
          error.message.includes(part),
        ),
    );

    expect(recorded.commands).to.deep.equal([]);
    expect(readText(path.join(folder, "pnpm-lock.yaml"))).to.equal(
      "installed: other\n",
    );
  });
});
