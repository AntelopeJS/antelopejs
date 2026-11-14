import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "chai";
import sinon from "sinon";

import { NodeFileSystem } from "../../../src/core/filesystem";
import { FileWatcher } from "../../../src/core/runtime";

const EVENT_SETTLE_MS = 300;

class VanishingFileSystem extends NodeFileSystem {
  constructor(private vanishingPaths: string[]) {
    super();
  }

  async readdir(dirPath: string): Promise<string[]> {
    const entries = await super.readdir(dirPath);
    await Promise.all(
      this.vanishingPaths.map((vanishingPath) =>
        rm(vanishingPath, { recursive: true, force: true }),
      ),
    );
    return entries;
  }
}

describe("FileWatcher Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "ajs-test-"));
    await writeFile(path.join(tempDir, "test.js"), "export const v = 1;");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should detect real file changes", async function () {
    this.timeout(5000);

    const watcher = new FileWatcher(new NodeFileSystem());
    await watcher.scanModule("test", tempDir);

    const changePromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for change")),
        2000,
      );
      watcher.onModuleChanged((id) => {
        clearTimeout(timeout);
        resolve(id);
      });
    });

    watcher.startWatching();

    try {
      await writeFile(path.join(tempDir, "test.js"), "export const v = 2;");
      expect(await changePromise).to.equal("test");
    } finally {
      watcher.stopWatching();
    }
  });

  it("reloads for a directory created at runtime", async function () {
    this.timeout(5000);

    const watcher = new FileWatcher(new NodeFileSystem());
    await watcher.scanModule("test", tempDir);

    const changePromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for change")),
        2000,
      );
      watcher.onModuleChanged((id) => {
        clearTimeout(timeout);
        resolve(id);
      });
    });

    watcher.startWatching();

    try {
      const pageDir = path.join(tempDir, "page");
      await mkdir(pageDir);
      await writeFile(path.join(pageDir, "page.js"), "export const p = 1;");
      expect(await changePromise).to.equal("test");
    } finally {
      watcher.stopWatching();
    }
  });

  it("adopts a file created at runtime so later edits also reload", async function () {
    this.timeout(5000);

    const watcher = new FileWatcher(new NodeFileSystem());
    await watcher.scanModule("test", tempDir);

    let count = 0;
    watcher.onModuleChanged((id) => {
      if (id === "test") {
        count++;
      }
    });

    const reaches = (target: number) =>
      new Promise<void>((resolve, reject) => {
        const check = setInterval(() => {
          if (count >= target) {
            clearInterval(check);
            clearTimeout(timeout);
            resolve();
          }
        }, 25);
        const timeout = setTimeout(() => {
          clearInterval(check);
          reject(new Error(`Timed out waiting for ${target} changes`));
        }, 2000);
      });

    watcher.startWatching();

    try {
      const added = path.join(tempDir, "added.js");
      await writeFile(added, "export const a = 1;");
      await reaches(1);
      const changesAfterCreate = count;
      await writeFile(added, "export const a = 2;");
      await reaches(changesAfterCreate + 1);

      expect(count).to.be.greaterThan(changesAfterCreate);
    } finally {
      watcher.stopWatching();
    }
  });
});

describe("FileWatcher Integration with a project root module", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "ajs-test-"));
    await writeFile(path.join(tempDir, "test.js"), "export const v = 1;");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("scans a project root whose files disappear during the scan", async () => {
    const stateDir = path.join(tempDir, ".antelope");
    const tmpFile = path.join(stateDir, "dev.json.tmp");
    const tmpDir = path.join(tempDir, "transient");
    await mkdir(stateDir);
    await writeFile(path.join(stateDir, "dev.json"), "{}");
    await writeFile(tmpFile, "{}");
    await mkdir(tmpDir);
    await writeFile(path.join(tmpDir, "file.js"), "export const t = 1;");

    const fs = new VanishingFileSystem([tmpFile, tmpDir]);
    const watcher = new FileWatcher(fs);
    await watcher.scanModule("project", tempDir);

    const reference = new FileWatcher(new NodeFileSystem());
    await reference.scanModule("project", tempDir);
    expect(watcher.getModuleSignature("project")).to.equal(
      reference.getModuleSignature("project"),
    );
  });

  it("does not watch an excluded project state folder", async () => {
    const stateDir = path.join(tempDir, ".antelope");
    await mkdir(stateDir);
    await writeFile(path.join(stateDir, "dev.json"), "{}");

    const watcher = new FileWatcher(new NodeFileSystem());
    watcher.excludePath(stateDir);
    await watcher.scanModule("project", tempDir);
    const baseline = watcher.getModuleSignature("project");

    let changes = 0;
    watcher.onModuleChanged(() => changes++);
    watcher.startWatching();

    try {
      await writeFile(path.join(stateDir, "dev.json.tmp"), "{}");
      await rm(path.join(stateDir, "dev.json.tmp"));
      await writeFile(path.join(stateDir, "dev.json"), "{ }");
      await new Promise((resolve) => setTimeout(resolve, EVENT_SETTLE_MS));
    } finally {
      watcher.stopWatching();
    }

    expect(changes).to.equal(0);
    expect(watcher.getModuleSignature("project")).to.equal(baseline);
  });
});

describe("FileWatcher Integration with a module that has no src folder", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "ajs-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("watches the other folders of a module that has no src folder", async function () {
    this.timeout(5000);
    const libFile = path.join(tempDir, "lib", "a.js");
    await mkdir(path.dirname(libFile));
    await writeFile(libFile, "export const a = 1;");
    const consoleError = sinon.stub(console, "error");

    const watcher = new FileWatcher(new NodeFileSystem());
    try {
      await watcher.scanModule("test", tempDir, ["src", "lib"]);
      const changePromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timed out waiting for change")),
          2000,
        );
        watcher.onModuleChanged((id) => {
          clearTimeout(timeout);
          resolve(id);
        });
      });
      watcher.startWatching();

      await writeFile(libFile, "export const a = 2;");
      expect(await changePromise).to.equal("test");
      expect(consoleError.called).to.equal(false);
    } finally {
      watcher.stopWatching();
      consoleError.restore();
    }
  });
});

describe("FileWatcher Integration with a deleted watched folder", () => {
  let parentDir: string;
  let watchedDir: string;

  const openWatchers = () =>
    process
      .getActiveResourcesInfo()
      .filter((resource) => resource === "FSEventWrap").length;

  const watchersClose = (target: number) =>
    new Promise<void>((resolve, reject) => {
      const check = setInterval(() => {
        if (openWatchers() <= target) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      }, 25);
      const timeout = setTimeout(() => {
        clearInterval(check);
        reject(new Error(`${openWatchers() - target} watchers stayed open`));
      }, 2000);
    });

  const changesAfterDeletion = async (watcher: FileWatcher) => {
    const baseline = openWatchers();
    watcher.startWatching();
    expect(openWatchers()).to.be.greaterThan(baseline);

    await rm(watchedDir, { recursive: true, force: true });
    await watchersClose(baseline);
    await new Promise((resolve) => setTimeout(resolve, EVENT_SETTLE_MS));
    const handleFileChange = sinon.spy(watcher, "handleFileChange");
    await new Promise((resolve) => setTimeout(resolve, EVENT_SETTLE_MS));
    return handleFileChange.callCount;
  };

  beforeEach(async () => {
    parentDir = await mkdtemp(path.join(tmpdir(), "ajs-test-"));
    watchedDir = path.join(parentDir, "watched");
    await mkdir(path.join(watchedDir, "src"), { recursive: true });
    await writeFile(
      path.join(watchedDir, "src", "a.js"),
      "export const a = 1;",
    );
    await writeFile(path.join(watchedDir, "antelope.config.ts"), "export {};");
  });

  afterEach(async () => {
    await rm(parentDir, { recursive: true, force: true });
  });

  it("closes the watchers of a module folder deleted while watching", async function () {
    this.timeout(5000);
    const watcher = new FileWatcher(new NodeFileSystem());
    await watcher.scanModule("test", watchedDir);
    try {
      expect(await changesAfterDeletion(watcher)).to.equal(0);
    } finally {
      watcher.stopWatching();
    }
  });

  it("closes the watcher of a project folder deleted while watching", async function () {
    this.timeout(5000);
    const watcher = new FileWatcher(new NodeFileSystem());
    await watcher.watchFile(
      path.join(watchedDir, "antelope.config.ts"),
      () => {},
    );
    const consoleWarn = sinon.stub(console, "warn");
    try {
      expect(await changesAfterDeletion(watcher)).to.equal(0);
    } finally {
      watcher.stopWatching();
      consoleWarn.restore();
    }
  });
});
