import { expect } from "chai";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../../src/core/downloaders";
import { ModuleCache } from "../../../src/core/modules";
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

const ENTRY = "pkg@1.0.0";
const HALF_INSTALLED = "module.exports = 'half';\n";
const DOWNLOADED = "module.exports = 'downloaded';\n";

/** Writes a package that declares `dep`, with an empty `node_modules/dep`, as an install stopped halfway leaves it. */
function writePackage(folder: string, index: string): void {
  writeJson(path.join(folder, "package.json"), {
    name: "pkg",
    version: "1.0.0",
    main: "index.js",
    dependencies: { dep: "^1.0.0" },
  });
  writeFileSync(path.join(folder, "index.js"), index);
  mkdirSync(path.join(folder, "node_modules", "dep"), { recursive: true });
}

describe("The package downloader and an install that stopped halfway", () => {
  let root: string;
  let cachePath: string;
  let installer: IdleProcess;
  let packs: number;

  beforeEach(async () => {
    root = makeTempDir("ajs-stopped-installs-");
    cachePath = path.join(root, "cache");
    packs = 0;
    installer = await startIdleProcess();
    writePackage(path.join(cachePath, ENTRY), HALF_INSTALLED);
    writeJson(path.join(cachePath, "manifest.json"), {});
    writeLease(cachePath, "installer.json", {
      ...thisProcess(),
      pid: installer.pid,
      entries: [ENTRY],
    });
  });

  afterEach(async () => {
    await installer.stop();
    cleanupTempDir(root);
  });

  async function load(): Promise<string> {
    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, {
      exec: async (command) => {
        if (command.startsWith("npm pack")) {
          packs += 1;
        }
        return { stdout: "pkg-1.0.0.tgz", stderr: "", code: 0 };
      },
      extract: async (_from, to) =>
        writePackage(path.join(to, "package"), DOWNLOADED),
      getInstallCommand: async () => "install",
      getTemp: async () => mkdtempSync(path.join(root, "pack-")),
    });
    const cache = new ModuleCache(cachePath);
    await cache.load();
    const [loaded] = await registry.load(root, cache, {
      type: "package",
      package: "pkg",
      version: "1.0.0",
    });
    return loaded.folder;
  }

  it("never adopts or lists the unlisted folder of a stopped installer, and downloads it again once that run is gone", async () => {
    const lease = path.join(cachePath, ".leases", "installer.json");

    await assert.rejects(load(), (error: Error) =>
      error.message.includes(lease),
    );
    expect(manifestKeys(cachePath)).to.deep.equal([]);
    expect(readText(path.join(cachePath, ENTRY, "index.js"))).to.equal(
      HALF_INSTALLED,
    );

    await installer.stop();
    const folder = await load();

    expect(readText(path.join(folder, "index.js"))).to.equal(DOWNLOADED);
    expect(manifestKeys(cachePath)).to.deep.equal([ENTRY]);
    expect(packs).to.equal(2);
  });
});
