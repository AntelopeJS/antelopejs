import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "chai";

import { NodeFileSystem } from "../../../src/core/filesystem";
import { FileWatcher } from "../../../src/core/runtime";

const CHANGE_TIMEOUT_MS = 2000;

describe("FileWatcher Integration with a recreated module folder", () => {
  let parentDir: string;
  let moduleDir: string;
  let watcher: FileWatcher;
  let changes: string[];

  const changeAfter = async (action: () => Promise<void>) => {
    const seen = changes.length;
    await action();
    await new Promise<void>((resolve, reject) => {
      const check = setInterval(() => {
        if (changes.length > seen) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      }, 25);
      const timeout = setTimeout(() => {
        clearInterval(check);
        reject(new Error("Timed out waiting for a module change"));
      }, CHANGE_TIMEOUT_MS);
    });
  };

  const writeModule = async (value: number) => {
    await mkdir(path.join(moduleDir, "src"), { recursive: true });
    await writeFile(
      path.join(moduleDir, "src", "a.js"),
      `export const a = ${value};`,
    );
  };

  const expectEditReloads = async () => {
    const before = watcher.getModuleSignature("test");
    await changeAfter(() =>
      writeFile(path.join(moduleDir, "src", "a.js"), "export const a = 3;"),
    );
    expect(changes.at(-1)).to.equal("test");
    expect(watcher.getModuleSignature("test")).to.not.equal(before);
  };

  beforeEach(async () => {
    parentDir = await mkdtemp(path.join(tmpdir(), "ajs-test-"));
    moduleDir = path.join(parentDir, "modules", "test");
    await writeModule(1);
    watcher = new FileWatcher(new NodeFileSystem());
    changes = [];
    watcher.onModuleChanged((id) => changes.push(id));
  });

  afterEach(async () => {
    watcher.stopWatching();
    await rm(parentDir, { recursive: true, force: true });
  });

  it("watches a module folder again once it is recreated", async () => {
    await watcher.scanModule("test", moduleDir);
    watcher.startWatching();

    await changeAfter(() => rm(moduleDir, { recursive: true, force: true }));
    await changeAfter(() => writeModule(2));

    await expectEditReloads();
  });

  it("watches a module folder again once it is moved back", async function () {
    if (process.platform === "win32") {
      this.skip();
    }
    const movedDir = path.join(parentDir, "moved");
    await watcher.scanModule("test", moduleDir);
    watcher.startWatching();

    await changeAfter(() => rename(moduleDir, movedDir));
    await changeAfter(() => rename(movedDir, moduleDir));

    await expectEditReloads();
  });

  it("watches a watch dir again once its deleted module folder is recreated", async () => {
    await watcher.scanModule("test", moduleDir, ["src"]);
    watcher.startWatching();

    await changeAfter(() =>
      rm(path.dirname(moduleDir), { recursive: true, force: true }),
    );
    await changeAfter(() => writeModule(2));

    await expectEditReloads();
  });

  it("watches a watch dir that is created after the scan", async () => {
    await rm(path.join(moduleDir, "src"), { recursive: true, force: true });
    await watcher.scanModule("test", moduleDir, ["src"]);
    watcher.startWatching();

    await changeAfter(() => writeModule(2));

    await expectEditReloads();
  });
});

describe("FileWatcher Integration while waiting for a missing folder", () => {
  const QUIET_MS = 300;
  const MAX_QUIET_STATS = 20;
  let parentDir: string;

  class SlowCountingFileSystem extends NodeFileSystem {
    stats = 0;

    constructor(private delayMs = 0) {
      super();
    }

    async stat(filePath: string) {
      await this.count();
      return super.stat(filePath);
    }

    async exists(filePath: string) {
      await this.count();
      return super.exists(filePath);
    }

    private async count() {
      this.stats++;
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
  }

  const openWatchers = () =>
    process
      .getActiveResourcesInfo()
      .filter((resource) => resource === "FSEventWrap").length;

  const statsWhileQuiet = async (fs: SlowCountingFileSystem) => {
    const before = fs.stats;
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
    return fs.stats - before;
  };

  beforeEach(async () => {
    parentDir = await mkdtemp(path.join(tmpdir(), "ajs-test-"));
  });

  afterEach(async () => {
    await rm(parentDir, { recursive: true, force: true });
  });

  it("waits quietly on a scanned folder that is a file, then watches it once it is a folder", async () => {
    const root = path.join(parentDir, "test");
    await writeFile(root, "not a folder");
    const fs = new SlowCountingFileSystem();
    const watcher = new FileWatcher(fs);
    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));
    await watcher.scanModule("test", root);
    watcher.startWatching();
    try {
      expect(await statsWhileQuiet(fs)).to.be.at.most(MAX_QUIET_STATS);
      await rm(root);
      await mkdir(root);
      await writeFile(path.join(root, "a.js"), "export const a = 1;");
      await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
      expect(changes).to.include("test");
    } finally {
      watcher.stopWatching();
    }
  });

  it("waits quietly on a folder whose parent is missing too", async () => {
    const fs = new SlowCountingFileSystem();
    const watcher = new FileWatcher(fs);
    await watcher.scanModule("test", path.join(parentDir, "modules", "test"), [
      "src",
    ]);
    watcher.startWatching();
    try {
      expect(await statsWhileQuiet(fs)).to.be.at.most(MAX_QUIET_STATS);
    } finally {
      watcher.stopWatching();
    }
  });

  it("leaves no watcher open when stopped while it looks for the folder", async () => {
    const baseline = openWatchers();
    const fs = new SlowCountingFileSystem(50);
    const watcher = new FileWatcher(fs);
    await watcher.scanModule("test", path.join(parentDir, "missing"));
    watcher.startWatching();
    await new Promise((resolve) => setTimeout(resolve, 20));
    watcher.stopWatching();
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
    expect(openWatchers()).to.equal(baseline);
  });
});
