import { expect } from "chai";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import path from "node:path";

import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../../src/core/downloaders";
import { ModuleCache } from "../../../src/core/modules";
import { cleanupTempDir, makeTempDir, writeJson } from "../../helpers/temp";

describe("The package downloader and a tarball of another version", () => {
  let root: string;
  let cachePath: string;

  beforeEach(() => {
    root = makeTempDir("ajs-packed-version-");
    cachePath = path.join(root, "cache");
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("refuses a tarball whose package.json names another version than the one it locked, writing no folder", async () => {
    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, {
      exec: async () => ({ stdout: "pkg-1.0.0.tgz", stderr: "", code: 0 }),
      extract: async (_from, to) =>
        writeJson(path.join(to, "package", "package.json"), {
          name: "pkg",
          version: "1.0.1",
        }),
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
      (error: Error) =>
        ["pkg@1.0.0", "1.0.1"].every((part) => error.message.includes(part)),
    );

    expect(existsSync(path.join(cachePath, "pkg@1.0.1"))).to.equal(false);
    expect(existsSync(path.join(cachePath, "pkg@1.0.0"))).to.equal(false);
  });
});
