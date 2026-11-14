import { expect } from "chai";
import { existsSync } from "node:fs";
import path from "node:path";

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
