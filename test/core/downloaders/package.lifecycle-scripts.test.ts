import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../../src/core/downloaders";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { ModuleCache } from "../../../src/core/modules";
import { ExecuteCMD } from "../../../src/core/output";
import { writeTarball } from "../../helpers/tarball";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

const INSTALL_TIMEOUT_MS = 120_000;
const TARBALL = "pkg-1.0.0.tgz";
const BUILT_MARKER = "built";

const FAILING_LIFECYCLE_SCRIPTS = {
  "pnpm:devPreinstall": "exit 2",
  preinstall: "exit 3",
  install: "exit 4",
  postinstall: "exit 5",
  prepublish: "exit 6",
  preprepare: "exit 7",
  prepare: "exit 8",
  postprepare: "exit 9",
  predependencies: "exit 10",
  dependencies: "exit 11",
  postdependencies: "exit 12",
};

const SOURCE: ModuleSourcePackage = {
  type: "package",
  package: "pkg",
  version: "1.0.0",
  id: "pkg",
};

/** Loads `files`, packed as `pkg@1.0.0`, through the package downloader with the real install command. */
async function loadPacked(
  root: string,
  files: Record<string, string>,
): Promise<string> {
  const pack = path.join(root, "pack");
  const fs = new NodeFileSystem();
  await fs.mkdir(pack, { recursive: true });
  writeTarball(path.join(pack, TARBALL), files);
  const cache = new ModuleCache(path.join(root, "cache"), fs);
  await cache.load();
  const registry = new DownloaderRegistry();
  registerPackageDownloader(registry, {
    fs,
    exec: (command, options) =>
      command.startsWith("npm pack")
        ? Promise.resolve({ stdout: TARBALL, stderr: "", code: 0 })
        : ExecuteCMD(command, options),
    getTemp: async () => pack,
  });
  const [loaded] = await registry.load(
    path.join(root, "project"),
    cache,
    SOURCE,
  );
  return loaded.folder;
}

describe("PackageDownloader installing a module whose own lifecycle scripts fail", function () {
  this.timeout(INSTALL_TIMEOUT_MS);
  let root: string;

  beforeEach(() => {
    root = makeTempDir("ajs-package-lifecycle-scripts-");
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("installs it with pnpm without running them", async () => {
    const folder = await loadPacked(root, {
      "package/package.json": JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        packageManager: "pnpm",
        scripts: FAILING_LIFECYCLE_SCRIPTS,
      }),
    });

    expect(existsSync(path.join(folder, "package.json"))).to.equal(true);
  });

  it("installs it with npm without running them, and still runs the install scripts of its dependencies", async () => {
    const folder = await loadPacked(root, {
      "package/package.json": JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        packageManager: "npm",
        scripts: FAILING_LIFECYCLE_SCRIPTS,
        dependencies: { dep: "file:./vendor/dep" },
      }),
      "package/vendor/dep/package.json": JSON.stringify({
        name: "dep",
        version: "1.0.0",
        scripts: {
          postinstall: `node -e "require('fs').writeFileSync('${BUILT_MARKER}', '')"`,
        },
      }),
    });

    expect(
      existsSync(path.join(folder, "node_modules", "dep", BUILT_MARKER)),
    ).to.equal(true);
  });
});
