import { expect } from "chai";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  findPackageFromEntry,
  isPathWithin,
  resolvePackage,
} from "../../../src/utils";
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

describe("package resolution of fields with the wrong type", () => {
  it("resolves a package.json whose version is a number, as the text it prints as", () => {
    const root = makeTempDir("ajs-package-version-");
    try {
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "numbered", version: 1 }),
      );
      const entry = path.join(root, "index.js");
      writeFileSync(entry, "module.exports = {};");

      expect(findPackageFromEntry(entry, "numbered", root)?.version).to.equal(
        "1",
      );
    } finally {
      cleanupTempDir(root);
    }
  });

  it("does not resolve a package.json whose version is falsy", () => {
    const root = makeTempDir("ajs-package-version-");
    try {
      const entry = path.join(root, "index.js");
      writeFileSync(entry, "module.exports = {};");
      for (const version of [0, "", false, null]) {
        writeFileSync(
          path.join(root, "package.json"),
          JSON.stringify({ name: "numbered", version }),
        );

        expect(findPackageFromEntry(entry, "numbered", root)).to.equal(
          undefined,
        );
      }
    } finally {
      cleanupTempDir(root);
    }
  });

  it("stops at a same-named package whose version is falsy instead of resolving an outer one", () => {
    const root = makeTempDir("ajs-package-outer-");
    try {
      const inner = path.join(root, "node_modules", "numbered");
      mkdirSync(inner, { recursive: true });
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "numbered", version: "9.9.9" }),
      );
      writeFileSync(
        path.join(inner, "package.json"),
        JSON.stringify({ name: "numbered", version: 0 }),
      );
      const entry = path.join(inner, "index.js");
      writeFileSync(entry, "module.exports = {};");

      expect(findPackageFromEntry(entry, "numbered", root)).to.equal(undefined);
    } finally {
      cleanupTempDir(root);
    }
  });

  it("keeps a truthy antelopeJs that is not an object as an empty declaration", () => {
    const root = makeTempDir("ajs-package-antelope-");
    try {
      const entry = path.join(root, "index.js");
      writeFileSync(entry, "module.exports = {};");
      for (const antelopeJs of ["x", [], true, 5]) {
        writeFileSync(
          path.join(root, "package.json"),
          JSON.stringify({ name: "marked", version: "1.0.0", antelopeJs }),
        );

        expect(
          findPackageFromEntry(entry, "marked", root)?.antelopeJs,
        ).to.deep.equal({});
      }
      for (const antelopeJs of ["", 0, false, null]) {
        writeFileSync(
          path.join(root, "package.json"),
          JSON.stringify({ name: "marked", version: "1.0.0", antelopeJs }),
        );

        expect(
          findPackageFromEntry(entry, "marked", root)?.antelopeJs,
        ).to.equal(undefined);
      }
    } finally {
      cleanupTempDir(root);
    }
  });
});
