import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../../src/core/downloaders";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { ModuleCache } from "../../../src/core/modules";
import { describeTree } from "../../helpers/file-tree";
import { type TarLink, writeTarball } from "../../helpers/tarball";
import { cleanupTempDir, listDirectory, makeTempDir } from "../../helpers/temp";
import { rejectionOf } from "../cli/fixtures";

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

  async function loadPack(pack: string) {
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

    return registry.load(path.join(root, "project"), cache, SOURCE);
  }

  it("writes the tree inly wrote: nested folders, the bin's mode, no symlink", async () => {
    const pack = path.join(root, "pack");
    packFixture(root, pack);

    const [loaded] = await loadPack(pack);

    expect(describeTree(loaded.folder)).to.deep.equal([
      `${IS_WINDOWS ? "file" : "file x"} bin.sh #!/bin/sh\n`,
      "dir lib",
      "dir lib/deep",
      "file lib/deep/data.txt nested\n",
      `file package.json ${MANIFEST}`,
    ]);
  });

  const HOSTILE_ENTRIES: [string, string, string | TarLink][] = [
    ["a .. path", "package/../../escape.txt", "escaped\n"],
    ["an absolute path", "/escape-absolute.txt", "escaped\n"],
    [
      "an absolute symlink",
      "package/evil-link",
      { link: "symlink", linkpath: "/" },
    ],
    [
      "a symlink that escapes",
      "package/evil-link",
      { link: "symlink", linkpath: "../../outside" },
    ],
    [
      "a hardlink that escapes",
      "package/hard",
      { link: "hardlink", linkpath: "../victim.txt" },
    ],
  ];

  for (const [name, entry, content] of HOSTILE_ENTRIES) {
    it(`refuses a tarball with ${name}, naming the entry and the package, and keeps nothing`, async () => {
      const pack = path.join(root, "pack");
      mkdirSync(pack, { recursive: true });
      writeTarball(path.join(pack, TARBALL), {
        "package/package.json": MANIFEST,
        [entry]: content,
      });

      const error = await rejectionOf(loadPack(pack));

      expect(error.message).to.include("fixture@1.0.0");
      expect(error.message).to.include(`entry ${entry}`);
      expect(existsSync(pack)).to.equal(false);
      expect(
        listDirectory(path.join(root, "cache")).filter(
          (child) => !child.startsWith("."),
        ),
      ).to.deep.equal([]);
    });
  }
});
