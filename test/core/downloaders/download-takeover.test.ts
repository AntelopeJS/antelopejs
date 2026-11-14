import type { ModuleSourceGit } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  DownloaderRegistry,
  registerGitDownloader,
} from "../../../src/core/downloaders";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { downloadLockOf, ModuleCache } from "../../../src/core/modules";
import {
  CHILD_TIMEOUT_MS,
  type ChildRun,
  loadPackageInChild,
  openGate,
  type PackageRun,
} from "../../helpers/cache-children";
import {
  manifestKeys,
  readLockOwner,
  seedCache,
  thisProcess,
} from "../../helpers/cache-leases";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";
import { cleanupTempDir, makeTempDir, writeJson } from "../../helpers/temp";

const ENTRY = "pkg@1.0.0";
const TAKEN_OVER = "taken-over";

/** Rewrites the owner of the download lock of {@link ENTRY}, as a process that took the lock over after 60 s of silence. */
function takeOverDownloadLock(cachePath: string): string {
  const lock = path.join(cachePath, downloadLockOf(ENTRY));
  writeJson(path.join(lock, "owner.json"), {
    ...thisProcess(),
    token: TAKEN_OVER,
    beat: 0,
  });
  return lock;
}

/** The message a run printed or threw, or `undefined` once it succeeded. */
function failureOf(run: Promise<unknown>): Promise<string | undefined> {
  return run.then(
    () => undefined,
    (error: unknown) => String(error),
  );
}

describe("A download whose lock another process took over", function () {
  this.timeout(CHILD_TIMEOUT_MS * 2);
  let root: string;
  let run: PackageRun;
  const children: ChildRun[] = [];

  beforeEach(() => {
    root = makeTempDir("ajs-download-takeover-");
    run = {
      cachePath: path.join(root, "cache"),
      project: path.join(root, "project"),
      tempRoot: root,
      packLog: path.join(root, "packs.log"),
      installGate: path.join(root, "install"),
    };
  });

  afterEach(async () => {
    openGate(path.join(root, "install"));
    await Promise.all(
      children.splice(0).map((child) => child.exited.catch(() => undefined)),
    );
    cleanupTempDir(root);
  });

  it("stops before it lists the version, and leaves the lock to the process that took it over", async () => {
    const child = loadPackageInChild(run);
    children.push(child);
    await child.printed("installing");

    const lock = takeOverDownloadLock(run.cachePath);
    openGate(path.join(root, "install"));
    const failure = await failureOf(child.exited);

    expect(failure)
      .to.be.a("string")
      .that.includes("took over the download lock of pkg@1.0.0");
    expect(manifestKeys(run.cachePath)).to.deep.equal([]);
    expect(readLockOwner(lock)?.token).to.equal(TAKEN_OVER);
  });

  it("stops before it replaces the folder", async () => {
    seedCache(run.cachePath, [ENTRY]);
    const cache = new ModuleCache(run.cachePath);

    const failure = await failureOf(
      cache.withDownloadLock(ENTRY, async () => {
        takeOverDownloadLock(run.cachePath);
        return cache.getFolder(ENTRY, false, false);
      }),
    );

    expect(failure)
      .to.be.a("string")
      .that.includes("took over the download lock of pkg@1.0.0");
    expect(existsSync(path.join(run.cachePath, ENTRY, "index.js"))).to.equal(
      true,
    );
  });
});

describe("A git update whose download lock another process took over", () => {
  it("stops after the fetch, before it checks out, resets or installs the clone, and lists no version", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    const remote = "https://github.com/org/repo.git";
    const name = remote.replace(/[^a-zA-Z0-9_]/g, "_");
    await fs.writeFile(`/cache/${name}/package.json`, "{}");
    await fs.writeFile(`/cache/${name}/.git/HEAD`, "ref: refs/heads/main");
    cache.setVersion(name, "git:main:oldcommit");
    const afterTakeover: string[] = [];
    let takenOver = false;
    const exec = async (command: string) => {
      if (takenOver) {
        afterTakeover.push(command);
      }
      if (command === "git fetch") {
        await fs.writeFile(
          `/cache/${downloadLockOf(name)}/owner.json`,
          JSON.stringify({ ...thisProcess(), token: TAKEN_OVER, beat: 0 }),
        );
        takenOver = true;
      }
      const stdout = command.startsWith("git rev-parse") ? "newcommit" : "";
      return { stdout, stderr: "", code: 0 };
    };
    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });
    const source: ModuleSourceGit = {
      type: "git",
      remote,
      branch: "develop",
      installCommand: ["npm install"],
    };

    const failure = await failureOf(registry.load("/project", cache, source));

    expect(failure)
      .to.be.a("string")
      .that.includes("took over the download lock");
    expect(afterTakeover).to.deep.equal([]);
    expect(cache.getVersion(name)).to.equal("git:main:oldcommit");
  });
});

/** The real file system, except that the next read of an `owner.json` fails with `EBUSY` once `failNextOwnerRead` is set, as on Windows while a heartbeat renames it. */
class BusyOwnerFileSystem extends NodeFileSystem {
  failNextOwnerRead = false;

  override readFileString(file: string, encoding?: BufferEncoding) {
    if (this.failNextOwnerRead && path.basename(file) === "owner.json") {
      this.failNextOwnerRead = false;
      return Promise.reject(
        Object.assign(new Error("EBUSY: resource busy or locked"), {
          code: "EBUSY",
        }),
      );
    }
    return super.readFileString(file, encoding);
  }
}

describe("A download that holds its lock while its owner cannot be read for a moment", () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir("ajs-download-busy-owner-");
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("lists the version", async () => {
    const cachePath = path.join(root, "cache");
    const fs = new BusyOwnerFileSystem();
    const cache = new ModuleCache(cachePath, fs);
    await cache.load();

    await cache.withDownloadLock(ENTRY, async () => {
      fs.failNextOwnerRead = true;
      await cache.commitVersion(ENTRY, "1.0.0");
    });

    expect(manifestKeys(cachePath)).to.deep.equal([ENTRY]);
  });
});
