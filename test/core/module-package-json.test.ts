import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";
import { expect } from "chai";

import { ModuleManifest } from "../../src/core/modules";
import { InMemoryFileSystem } from "../helpers/in-memory-filesystem";
import { rejectionOf } from "./cli/fixtures";

async function readPackageJson(content: string, dedicated?: string) {
  const fs = new InMemoryFileSystem();
  await fs.writeFile("/mod/package.json", content);
  if (dedicated !== undefined) {
    await fs.writeFile("/mod/antelope.module.json", dedicated);
  }
  return ModuleManifest.readManifest("/mod", fs);
}

describe("module package.json decoding", () => {
  it("reads a package.json without name or version", async () => {
    const manifest = await readPackageJson('{"main":"index.js"}');
    expect([manifest.name, manifest.version]).to.deep.equal([
      undefined,
      undefined,
    ]);
  });

  it("reads a version that is not a string as missing", async () => {
    const manifest = await readPackageJson('{"name":"mod","version":5}');
    expect(manifest.version).to.equal(undefined);
  });

  it("refuses a name that is not a string", async () => {
    const error = await rejectionOf(readPackageJson('{"name":5}'));
    expect(error.message).to.match(/name must be a string/);
  });

  it("refuses a dependency spec that is not a string, as npm and pnpm do", async () => {
    const error = await rejectionOf(
      readPackageJson('{"name":"mod","dependencies":{"semver":5}}'),
    );
    expect(error.message).to.match(/dependencies\.semver must be a string/);
  });

  it("refuses an antelope.module.json path list that is not a list of strings", async () => {
    const error = await rejectionOf(
      readPackageJson('{"name":"mod"}', '{"paths":{"@/*":"src/*"}}'),
    );
    expect(error.message).to.match(/antelopeJs\.paths\.@\/\* must be a list/);
  });

  it("reads an implements string character by character, as the runtime always has", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/mod/package.json",
      '{"name":"mod","antelopeJs":{"implements":"ab"}}',
    );
    const source: ModuleSourceLocal = { type: "local", path: "/mod" };
    const manifest = await ModuleManifest.create("/mod", source, "mod", fs);
    expect(manifest.implements).to.deep.equal(["a", "b"]);
  });

  it("keeps the members the core does not read", async () => {
    const manifest = await readPackageJson(
      '{"name":"mod","description":"kept","antelopeJs":{"defaultConfig":{"a":1}}}',
    );
    expect(manifest).to.deep.include({ description: "kept" });
    expect(manifest.antelopeJs?.defaultConfig).to.deep.equal({ a: 1 });
  });
});
