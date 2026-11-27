import { expect } from "chai";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  type ChildRun,
  INSTALLED_LOCKFILE,
  loadPackageInChild,
  openGate,
  type PackageRun,
} from "../../helpers/cache-children";
import { manifestKeys, seedCache } from "../../helpers/cache-leases";
import { cleanupTempDir, makeTempDir, readText } from "../../helpers/temp";

const ENTRY = "pkg@1.0.0";
const SEEDED_INDEX = "module.exports = {};\n";
const SEEDED_LOCKFILE = "seeded lockfile";
const WAITING_MS = 500;

/** The path a child printed after `loaded `. */
function loadedFolder(output: string): string | undefined {
  return /loaded (.+)/.exec(output)?.[1]?.trim();
}

/** The pids the `npm pack` double logged, one per pack. */
function packs(run: PackageRun): string[] {
  return existsSync(run.packLog)
    ? readText(run.packLog).split("\n").filter(Boolean)
    : [];
}

describe("Two runs loading the same package version into one cache", function () {
  this.timeout(0);
  let root: string;
  let base: PackageRun;
  const children: ChildRun[] = [];

  beforeEach(() => {
    root = makeTempDir("ajs-cache-concurrent-runs-");
    base = {
      cachePath: path.join(root, "cache"),
      project: path.join(root, "project"),
      tempRoot: root,
      packLog: path.join(root, "packs.log"),
    };
  });

  afterEach(async () => {
    openGate(path.join(root, "start"));
    openGate(path.join(root, "exit"));
    openGate(path.join(root, "install"));
    await Promise.all(
      children.splice(0).map((child) => child.exited.catch(() => undefined)),
    );
    cleanupTempDir(root);
  });

  function start(run: PackageRun): ChildRun {
    const child = loadPackageInChild(run);
    children.push(child);
    return child;
  }

  async function runBesideDevRun(run: PackageRun): Promise<string> {
    seedCache(base.cachePath, [ENTRY]);
    writeFileSync(
      path.join(base.cachePath, ENTRY, INSTALLED_LOCKFILE),
      SEEDED_LOCKFILE,
    );
    const startGate = path.join(root, "start");
    const dev = start({ ...base, exitGate: path.join(root, "exit") });
    const beside = start({ ...run, startGate });
    await dev.printed("loaded");
    openGate(startGate);
    return beside.exited;
  }

  function expectDevFolderUntouched(): void {
    expect(readText(path.join(base.cachePath, ENTRY, "index.js"))).to.equal(
      SEEDED_INDEX,
    );
    expect(packs(base)).to.deep.equal([]);
    expect(manifestKeys(base.cachePath)).to.deep.equal([ENTRY]);
  }

  it("lets modules update refresh a version a dev run uses: it keeps that folder, records its lock and keeps the entry", async () => {
    const output = await runBesideDevRun({ ...base, mode: "refresh" });

    expect(loadedFolder(output)).to.equal(path.join(base.cachePath, ENTRY));
    expectDevFolderUntouched();
    expect(
      readText(
        path.join(base.project, "antelope-lock", ENTRY, INSTALLED_LOCKFILE),
      ),
    ).to.equal(SEEDED_LOCKFILE);
  });

  it("lets a build whose source ignores the cache load a version a dev run uses, keeping that folder and its entry", async () => {
    const output = await runBesideDevRun({ ...base, ignoreCache: true });

    expect(loadedFolder(output)).to.equal(path.join(base.cachePath, ENTRY));
    expectDevFolderUntouched();
  });

  it("makes a second cold start wait for the first one's download, then reuse its folder, packing once", async () => {
    const installGate = path.join(root, "install");
    const startGate = path.join(root, "start");
    const first = start({ ...base, installGate });
    const second = start({ ...base, startGate });
    await first.printed("installing");
    openGate(startGate);
    await second.printed("loading");
    await new Promise((resolve) => setTimeout(resolve, WAITING_MS));
    openGate(installGate);

    const outputs = await Promise.all([first.exited, second.exited]);

    expect(outputs.map(loadedFolder)).to.deep.equal([
      path.join(base.cachePath, ENTRY),
      path.join(base.cachePath, ENTRY),
    ]);
    expect(packs(base)).to.have.length(1);
    expect(manifestKeys(base.cachePath)).to.deep.equal([ENTRY]);
  });
});
