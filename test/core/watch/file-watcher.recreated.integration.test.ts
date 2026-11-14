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

  it("watches a module folder again once it is moved back", async () => {
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
});
