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

/** Loads the `fixture@1.0.0` tarball in `pack` through the package downloader, with its cache under `root`. */
async function loadPack(root: string, pack: string) {
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

const HOSTILE_TARBALLS: [string, string, Record<string, string | TarLink>][] = [
  [
    "a .. path",
    "package/../../escape.txt",
    { "package/../../escape.txt": "escaped\n" },
  ],
  [
    "an absolute path",
    "/escape-absolute.txt",
    { "/escape-absolute.txt": "escaped\n" },
  ],
  [
    "an absolute symlink",
    "package/evil-link",
    { "package/evil-link": { link: "symlink", linkpath: "/" } },
  ],
  [
    "a symlink that escapes",
    "package/evil-link",
    { "package/evil-link": { link: "symlink", linkpath: "../../outside" } },
  ],
  [
    "a hardlink that escapes",
    "package/hard",
    { "package/hard": { link: "hardlink", linkpath: "../victim.txt" } },
  ],
  [
    "a chained symlink whose real path leaves the temp folder",
    "package/esc",
    {
      "other/x/keep.txt": "k",
      "package/a/b/c/d/o": {
        link: "symlink",
        linkpath: "../../../../../other/x",
      },
      "package/esc": {
        link: "symlink",
        linkpath: "a/b/c/d/o/../../../outside-canary",
      },
    },
  ],
  [
    "a symlink to the folder above the package",
    "package/up",
    { "package/up": { link: "symlink", linkpath: ".." } },
  ],
  [
    "a symlink to a folder in the package",
    "package/libs",
    {
      "package/lib/index.js": "lib\n",
      "package/libs": { link: "symlink", linkpath: "lib" },
    },
  ],
  [
    "a hardlink to a file beside the package folder",
    "package/h",
    {
      "other/secret.txt": "secret\n",
      "package/h": { link: "hardlink", linkpath: "other/secret.txt" },
    },
  ],
];

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

    const [loaded] = await loadPack(root, pack);

    expect(describeTree(loaded.folder)).to.deep.equal([
      `${IS_WINDOWS ? "file" : "file x"} bin.sh #!/bin/sh\n`,
      "dir lib",
      "dir lib/deep",
      "file lib/deep/data.txt nested\n",
      `file package.json ${MANIFEST}`,
    ]);
  });

  it("installs a symlink that stays in the package as a copy of its target", async () => {
    const pack = path.join(root, "pack");
    mkdirSync(pack, { recursive: true });
    writeTarball(path.join(pack, TARBALL), {
      "package/package.json": MANIFEST,
      "package/index.js": "index\n",
      "package/t": { link: "symlink", linkpath: "./index.js" },
    });

    const [loaded] = await loadPack(root, pack);

    expect(describeTree(loaded.folder)).to.deep.equal([
      "file index.js index\n",
      `file package.json ${MANIFEST}`,
      "file t index\n",
    ]);
  });

  for (const [name, entry, files] of HOSTILE_TARBALLS) {
    it(`refuses a tarball with ${name}, naming the entry and the package, and keeps nothing`, async () => {
      const pack = path.join(root, "pack");
      mkdirSync(pack, { recursive: true });
      mkdirSync(path.join(root, "outside-canary"));
      writeFileSync(
        path.join(root, "outside-canary", "canary.txt"),
        "outside\n",
      );
      writeTarball(path.join(pack, TARBALL), {
        "package/package.json": MANIFEST,
        ...files,
      });

      const error = await rejectionOf(loadPack(root, pack));

      expect(error.message).to.include(
        "Refused to unpack fixture-1.0.0.tgz of fixture@1.0.0",
      );
      expect(error.message).to.include(`entry ${entry}:`);
      expect(existsSync(pack)).to.equal(false);
      expect(
        listDirectory(path.join(root, "cache")).filter(
          (child) => !child.startsWith("."),
        ),
      ).to.deep.equal([]);
    });
  }
});
