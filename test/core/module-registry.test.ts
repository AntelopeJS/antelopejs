import { expect } from "chai";
import { manifestFixture } from "../helpers/module-fixtures";

import { Module, ModuleRegistry } from "../../src/core/modules";

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
