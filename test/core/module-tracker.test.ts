import { internal } from "@antelopejs/interface-core/internal";
import { expect } from "chai";
import { ModuleTracker } from "../../src/core/module-tracker";

describe("ModuleTracker", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
  });

  it("should add module entries", () => {
    const tracker = new ModuleTracker();

    tracker.add({ id: "modA", dir: "/modA" });
    tracker.add({ id: "modB", dir: "/modB" });

    expect(internal.moduleByFolder).to.have.length(2);
  });

  it("should clear all module entries", () => {
    const tracker = new ModuleTracker();

    tracker.add({ id: "modA", dir: "/modA" });
    tracker.clear();

    expect(internal.moduleByFolder).to.have.length(0);
  });
});
