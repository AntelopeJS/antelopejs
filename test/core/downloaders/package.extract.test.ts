import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../../src/core/downloaders";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { ModuleCache } from "../../../src/core/modules";
import { describeTree } from "../../helpers/file-tree";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

const PACK_TIMEOUT_MS = 60_000;
const TARBALL = "fixture-1.0.0.tgz";
const IS_WINDOWS = process.platform === "win32";

const SOURCE: ModuleSourcePackage = {
  type: "package",
  package: "fixture",
  version: "1.0.0",
  id: "fixture",
};

const MANIFEST = JSON.stringify(
  { name: "fixture", version: "1.0.0", bin: { fixture: "bin.sh" } },
  null,
  2,
);

/** Writes a package with a nested folder, an executable bin and a symlink, and packs it with pnpm into `pack`. */
function packFixture(root: string, pack: string): void {
  const fixture = path.join(root, "fixture");
  mkdirSync(path.join(fixture, "lib", "deep"), { recursive: true });
  writeFileSync(path.join(fixture, "package.json"), MANIFEST);
  writeFileSync(path.join(fixture, "lib", "deep", "data.txt"), "nested\n");
  writeFileSync(path.join(fixture, "bin.sh"), "#!/bin/sh\n");
  chmodSync(path.join(fixture, "bin.sh"), 0o755);
  symlinkSync(
    path.join("lib", "deep", "data.txt"),
    path.join(fixture, "link.txt"),
    "file",
  );
  mkdirSync(pack, { recursive: true });
  execFileSync("pnpm", ["pack", "--pack-destination", pack], {
    cwd: fixture,
    stdio: "ignore",
    shell: IS_WINDOWS,
  });
}

describe("PackageDownloader unpacking a tarball pnpm packed", function () {
  this.timeout(PACK_TIMEOUT_MS);
  let root: string;

  beforeEach(() => {
    root = makeTempDir("ajs-package-extract-");
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("writes the tree inly wrote: nested folders, the bin's mode, no symlink", async () => {
    const pack = path.join(root, "pack");
    packFixture(root, pack);
    const fs = new NodeFileSystem();
    const cache = new ModuleCache(path.join(root, "cache"), fs);
    await cache.load();
    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, {
      fs,
      exec: (command) =>
        Promise.resolve({
          stdout: command.startsWith("npm pack") ? TARBALL : "",
          stderr: "",
          code: 0,
        }),
      getInstallCommand: async () => "install",
      getTemp: async () => pack,
    });

    const [loaded] = await registry.load(
      path.join(root, "project"),
      cache,
      SOURCE,
    );

    expect(describeTree(loaded.folder)).to.deep.equal([
      `${IS_WINDOWS ? "file" : "file x"} bin.sh #!/bin/sh\n`,
      "dir lib",
      "dir lib/deep",
      "file lib/deep/data.txt nested\n",
      `file package.json ${MANIFEST}`,
    ]);
  });
});
