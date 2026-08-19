import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "chai";
import {
  findPackageFromEntry,
  isPathWithin,
  resolvePackage,
} from "../../../src/core/resolution/package-resolution";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

interface SymlinkPackageFixture {
  root: string;
  consumer: string;
  packageRoot: string;
  packageLink: string;
  entry: string;
}

function createSymlinkPackage(packageName: string): SymlinkPackageFixture {
  const root = makeTempDir("ajs-package-resolution-");
  const consumer = path.join(root, "consumer");
  const packageRoot = path.join(root, "workspace", ...packageName.split("/"));
  const packageLink = path.join(
    consumer,
    "node_modules",
    ...packageName.split("/"),
  );
  const entry = path.join(packageRoot, "dist", "index.js");
  mkdirSync(path.dirname(entry), { recursive: true });
  mkdirSync(path.dirname(packageLink), { recursive: true });
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: packageName,
      version: "1.2.3",
      exports: { ".": "./dist/index.js" },
      antelopeJs: {},
    }),
  );
  writeFileSync(entry, "module.exports = {};");
  symlinkSync(packageRoot, packageLink, "dir");
  return { root, consumer, packageRoot, packageLink, entry };
}

describe("package resolution", () => {
  for (const packageName of ["interface-plain", "@scope/interface-scoped"]) {
    it(`discovers ${packageName} through a workspace symlink and hidden manifest`, () => {
      const fixture = createSymlinkPackage(packageName);
      try {
        const resolvedPackage = resolvePackage(packageName, fixture.consumer);

        expect(resolvedPackage?.name).to.equal(packageName);
        expect(resolvedPackage?.version).to.equal("1.2.3");
        expect(resolvedPackage?.realRoot).to.equal(fixture.packageRoot);
        expect(resolvedPackage?.entry).to.equal(fixture.entry);
      } finally {
        cleanupTempDir(fixture.root);
      }
    });
  }

  it("preserves a logical package root when the resolved entry is not canonicalized", () => {
    const fixture = createSymlinkPackage("@scope/interface-logical");
    try {
      const logicalEntry = path.join(fixture.packageLink, "dist", "index.js");
      const resolvedPackage = findPackageFromEntry(
        logicalEntry,
        "@scope/interface-logical",
        fixture.consumer,
      );

      expect(resolvedPackage?.root).to.equal(fixture.packageLink);
      expect(resolvedPackage?.realRoot).to.equal(fixture.packageRoot);
      expect(isPathWithin(fixture.entry, fixture.packageLink)).to.equal(true);
      expect(isPathWithin(logicalEntry, fixture.packageRoot)).to.equal(true);
    } finally {
      cleanupTempDir(fixture.root);
    }
  });

  it("resolves an exported package from inside its own workspace root", () => {
    const fixture = createSymlinkPackage("@scope/interface-self");
    try {
      const resolvedPackage = resolvePackage(
        "@scope/interface-self",
        fixture.packageRoot,
      );

      expect(resolvedPackage?.root).to.equal(fixture.packageRoot);
      expect(resolvedPackage?.entry).to.equal(fixture.entry);
    } finally {
      cleanupTempDir(fixture.root);
    }
  });

  it("uses path boundaries for module ownership", () => {
    expect(isPathWithin("/modules/mod-a/index.js", "/modules/mod-a")).to.equal(
      true,
    );
    expect(isPathWithin("/modules/mod-a2/index.js", "/modules/mod-a")).to.equal(
      false,
    );
  });
});
