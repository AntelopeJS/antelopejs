import { manifestFixture } from "../helpers/module-fixtures";
import { expect } from "chai";

import { Module } from "../../src/core/modules/module";
import { ModuleRegistry } from "../../src/core/modules/module-registry";

const manifest = manifestFixture({
  name: "mod",
  version: "1.0.0",
  main: "/mod/index.js",
});

describe("ModuleRegistry", () => {
  it("should register and return modules", () => {
    const registry = new ModuleRegistry();
    const mod = new Module(manifest, async () => ({}));

    registry.register(mod);

    expect(registry.list()).to.deep.equal(["mod"]);
    expect(registry.get("mod")).to.equal(mod);
  });
});
