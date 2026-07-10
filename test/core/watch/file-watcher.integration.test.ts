import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { FileWatcher } from "../../../src/core/watch/file-watcher";

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

    const changePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for change")),
        2000,
      );
      watcher.onModuleChanged((id) => {
        if (id === "test") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    watcher.startWatching();

    try {
      await writeFile(path.join(tempDir, "test.js"), "export const v = 2;");
      await changePromise;
    } finally {
      watcher.stopWatching();
    }
  });

  it("reloads for a directory created at runtime", async function () {
    this.timeout(5000);

    const watcher = new FileWatcher(new NodeFileSystem());
    await watcher.scanModule("test", tempDir);

    const changePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for change")),
        2000,
      );
      watcher.onModuleChanged((id) => {
        if (id === "test") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    watcher.startWatching();

    try {
      const pageDir = path.join(tempDir, "page");
      await mkdir(pageDir);
      await writeFile(path.join(pageDir, "page.js"), "export const p = 1;");
      await changePromise;
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
      await writeFile(added, "export const a = 2;");
      await reaches(2);
    } finally {
      watcher.stopWatching();
    }
  });
});
