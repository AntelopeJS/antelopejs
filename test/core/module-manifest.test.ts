import { expect } from "chai";
import * as path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";

import { cleanupTempDir, makeTempDir } from "../helpers/temp";
import { InMemoryFileSystem } from "../helpers/in-memory-filesystem";
import type { BuildModuleEntry } from "../../src/core/build/build-artifact";
import {
  ModuleManifest,
  type ModulePackageJson,
  resolveManifestEntryFile,
} from "../../src/core/module-manifest";

describe("ModuleManifest", () => {
  it("throws when package.json is missing", async () => {
    const fs = new InMemoryFileSystem();
    let caught: unknown;
    try {
      await ModuleManifest.readManifest("/mod", fs);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);
  });
  it("should prefer antelope.module.json over package.json config", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/mod/package.json",
      JSON.stringify({
        name: "mod",
        version: "1.0.0",
        antelopeJs: {
          implements: ["a@beta"],
        },
      }),
    );

    await fs.writeFile(
      "/mod/antelope.module.json",
      JSON.stringify({
        implements: ["b@beta"],
      }),
    );

    const manifest = await ModuleManifest.readManifest("/mod", fs);

    expect(manifest.name).to.equal("mod");
    expect(manifest.antelopeJs?.implements).to.deep.equal(["b@beta"]);
  });

  it("should map baseUrl and paths", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/mod/package.json",
      JSON.stringify({
        name: "mod",
        version: "1.0.0",
        antelopeJs: {
          baseUrl: "src",
          paths: {
            "@lib/*": ["lib/*"],
          },
        },
      } as ModulePackageJson),
    );

    const source: ModuleSourceLocal = { type: "local", path: "/mod" };
    const manifest = await ModuleManifest.create("/mod", source, "mod", fs);

    expect(manifest.baseUrl).to.equal(path.join("/mod", "src"));
    expect(manifest.paths).to.deep.equal([
      {
        key: "@lib/",
        values: [path.join("/mod", "src", "lib/")],
      },
    ]);
  });

  it("should combine module aliases", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/mod/package.json",
      JSON.stringify({
        name: "mod",
        version: "1.0.0",
        _moduleAliases: {
          "@root": "src",
        },
        antelopeJs: {
          moduleAliases: {
            "@lib": "lib",
          },
        },
      } as ModulePackageJson),
    );

    const source: ModuleSourceLocal = { type: "local", path: "/mod" };
    const manifest = await ModuleManifest.create("/mod", source, "mod", fs);

    expect(manifest.srcAliases).to.deep.include({
      alias: "@root",
      replace: path.join("/mod", "src"),
    });
    expect(manifest.srcAliases).to.deep.include({
      alias: "@lib",
      replace: path.join("/mod", "lib"),
    });
  });

  it("supports moduleAliases without _moduleAliases", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/mod/package.json",
      JSON.stringify({
        name: "mod",
        version: "1.0.0",
        antelopeJs: {
          moduleAliases: {
            "@lib": "lib",
          },
        },
      } as ModulePackageJson),
    );

    const source: ModuleSourceLocal = { type: "local", path: "/mod" };
    const manifest = await ModuleManifest.create("/mod", source, "mod", fs);

    expect(manifest.srcAliases).to.deep.include({
      alias: "@lib",
      replace: path.join("/mod", "lib"),
    });
  });

  it("should read dependencies from package.json", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/mod/package.json",
      JSON.stringify({
        name: "mod",
        version: "1.0.0",
        dependencies: {
          "@antelopejs/interface-core": "^0.0.2",
          "@antelopejs/interface-api": "^0.0.2",
        },
      } as ModulePackageJson),
    );

    const source: ModuleSourceLocal = { type: "local", path: "/mod" };
    const manifest = await ModuleManifest.create("/mod", source, "mod", fs);

    expect(manifest.manifest.dependencies).to.deep.equal({
      "@antelopejs/interface-core": "^0.0.2",
      "@antelopejs/interface-api": "^0.0.2",
    });
  });

  it("reads implements from antelopeJs.implements", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/mod/package.json",
      JSON.stringify({
        name: "mod",
        version: "1.0.0",
        antelopeJs: {
          implements: ["@antelopejs/interface-database"],
        },
      } as ModulePackageJson),
    );

    const source: ModuleSourceLocal = { type: "local", path: "/mod" };
    const manifest = await ModuleManifest.create("/mod", source, "mod", fs);

    expect(manifest.implements).to.deep.equal([
      "@antelopejs/interface-database",
    ]);
  });

  it("defaults implements to an empty list", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/mod/package.json",
      JSON.stringify({
        name: "mod",
        version: "1.0.0",
      } as ModulePackageJson),
    );

    const source: ModuleSourceLocal = { type: "local", path: "/mod" };
    const manifest = await ModuleManifest.create("/mod", source, "mod", fs);

    expect(manifest.implements).to.deep.equal([]);
  });

  it("reloads manifest data and updates version", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/mod/package.json",
      JSON.stringify({
        name: "mod",
        version: "1.0.0",
        antelopeJs: { implements: ["@antelopejs/interface-core"] },
      } as ModulePackageJson),
    );

    const source: ModuleSourceLocal = { type: "local", path: "/mod" };
    const manifest = await ModuleManifest.create("/mod", source, "mod", fs);

    await fs.writeFile(
      "/mod/package.json",
      JSON.stringify({
        name: "mod",
        version: "1.0.1",
        antelopeJs: {
          implements: ["@antelopejs/interface-api"],
        },
      } as ModulePackageJson),
    );

    await manifest.reload();

    expect(manifest.version).to.equal("1.0.1");
    expect(manifest.implements).to.deep.equal(["@antelopejs/interface-api"]);
  });

  it("resets implements when reload removes them", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/mod/package.json",
      JSON.stringify({
        name: "mod",
        version: "1.0.0",
        antelopeJs: { implements: ["@antelopejs/interface-core"] },
      } as ModulePackageJson),
    );

    const source: ModuleSourceLocal = { type: "local", path: "/mod" };
    const manifest = await ModuleManifest.create("/mod", source, "mod", fs);

    await fs.writeFile(
      "/mod/package.json",
      JSON.stringify({
        name: "mod",
        version: "1.0.1",
      } as ModulePackageJson),
    );

    await manifest.reload();

    expect(manifest.implements).to.deep.equal([]);
  });

  it("serializes and reconstructs from build entries", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/mod/package.json",
      JSON.stringify({
        name: "mod",
        version: "1.0.0",
        antelopeJs: {
          implements: ["@antelopejs/interface-database"],
        },
      } as ModulePackageJson),
    );

    const source: ModuleSourceLocal = {
      type: "local",
      path: "/mod",
      main: "dist/index.js",
    };
    const manifest = await ModuleManifest.create("/mod", source, "mod", fs);

    const entry = manifest.serialize();
    const rebuilt = ModuleManifest.fromBuildEntry(entry);
    const rebuiltEntry = rebuilt.serialize() as BuildModuleEntry;

    expect(rebuiltEntry.folder).to.equal(entry.folder);
    expect(rebuiltEntry.name).to.equal(entry.name);
    expect(rebuiltEntry.version).to.equal(entry.version);
    expect(rebuiltEntry.main).to.equal(entry.main);
    expect(rebuiltEntry.implements).to.deep.equal(entry.implements);
    expect(rebuiltEntry.baseUrl).to.equal(entry.baseUrl);
    expect(rebuiltEntry.paths).to.deep.equal(entry.paths);
  });

  it("moves a build entry's paths into an instance copy of its folder, and leaves outside paths alone", () => {
    const manifest = ModuleManifest.fromBuildEntry({
      folder: "/mod",
      source: { type: "local" },
      name: "mod",
      version: "1.0.0",
      main: "/mod/dist/index.js",
      manifest: { name: "mod", version: "1.0.0" },
      implements: ["@antelopejs/interface-database"],
      baseUrl: "/mod/dist",
      paths: [{ key: "@lib/", values: ["/mod/dist/lib/", "/shared/lib/"] }],
      srcAliases: [{ alias: "@src", replace: "/mod/src" }],
    });

    const relocated = manifest.relocate("/copies/mod-2").serialize();

    expect(relocated.folder).to.equal("/copies/mod-2");
    expect(relocated.main).to.equal("/copies/mod-2/dist/index.js");
    expect(relocated.baseUrl).to.equal("/copies/mod-2/dist");
    expect(relocated.paths).to.deep.equal([
      { key: "@lib/", values: ["/copies/mod-2/dist/lib/", "/shared/lib/"] },
    ]);
    expect(relocated.srcAliases).to.deep.equal([
      { alias: "@src", replace: "/copies/mod-2/src" },
    ]);
    expect(relocated.implements).to.deep.equal([
      "@antelopejs/interface-database",
    ]);
    expect(relocated.version).to.equal("1.0.0");
  });
});

describe("resolveManifestEntryFile", () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir("ajs-manifest-entry-");
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("returns the entry file a module folder stands for", () => {
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "nested", version: "1.0.0", main: "dist/mod.js" }),
    );
    mkdirSync(path.join(root, "dist"), { recursive: true });
    writeFileSync(path.join(root, "dist", "mod.js"), "module.exports = {};");

    expect(resolveManifestEntryFile({ main: root })).to.equal(
      path.join(root, "dist", "mod.js"),
    );
  });

  it("leaves an entry that already names a file alone", () => {
    const entry = path.join(root, "index.js");
    writeFileSync(entry, "module.exports = {};");

    expect(resolveManifestEntryFile({ main: entry })).to.equal(entry);
  });

  it("falls back to the folder when no entry can be resolved yet", () => {
    expect(resolveManifestEntryFile({ main: root })).to.equal(root);
  });

  it("returns undefined when the manifest names no entry", () => {
    expect(resolveManifestEntryFile({})).to.equal(undefined);
  });
});
