import path from "node:path";
import { expect } from "chai";
import { tmpdir } from "node:os";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";

import { ModuleIsolation } from "../../src/core/module-isolation";
import { ModuleManifest } from "../../src/core/module-manifest";

describe("ModuleIsolation", () => {
  let root: string;
  let folder: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ajs-isolation-unit-"));
    folder = path.join(root, "module");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      path.join(folder, "package.json"),
      JSON.stringify({ name: "module", version: "1.0.0" }),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function manifest(): Promise<ModuleManifest> {
    const source: ModuleSourceLocal = { type: "local", path: folder };
    return ModuleManifest.create(folder, source, "module");
  }

  it("loads the first module from its folder and a second one from a copy", async () => {
    const isolation = new ModuleIsolation(path.join(root, "instances"));
    const first = isolation.place("first", await manifest());
    isolation.adopt("first", first);

    const second = isolation.place("second", await manifest());

    expect(first.folder).to.equal(folder);
    expect(second.folder).to.not.equal(folder);
    expect(existsSync(path.join(second.folder, "package.json"))).to.equal(true);
  });

  it("deletes the copy of a placed module that never runs", async () => {
    const isolation = new ModuleIsolation(path.join(root, "instances"));
    isolation.adopt("first", isolation.place("first", await manifest()));
    const second = isolation.place("second", await manifest());

    isolation.discard(second);

    expect(existsSync(second.folder)).to.equal(false);
  });
});
