import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import { expect } from "chai";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sinon from "sinon";

import { ModuleIsolation, ModuleManifest } from "../../src/core/modules";

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
    sinon.restore();
    rmSync(root, { recursive: true, force: true });
  });

  function linkDependency(name: string, target: string): void {
    mkdirSync(target, { recursive: true });
    mkdirSync(path.join(folder, "node_modules"), { recursive: true });
    symlinkSync(target, path.join(folder, "node_modules", name));
  }

  async function placeSecond(): Promise<void> {
    const isolation = new ModuleIsolation(path.join(root, "instances"));
    isolation.adopt("first", isolation.place("first", await manifest()));
    isolation.place("second", await manifest());
  }

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

  it("warns, naming the module and the links, when a copy follows links out of the module folder", async () => {
    const warn = sinon.stub(Logging.Channel.prototype, "Warn");
    for (const name of ["a", "b", "c", "d"]) {
      linkDependency(name, path.join(root, "workspace", name));
    }

    await placeSecond();

    expect(warn.calledOnce).to.equal(true);
    const [message] = warn.firstCall.args;
    expect(message).to.include("Module second");
    expect(message).to.include(path.join("node_modules", "a"));
    expect(message).to.include("and 1 more");
  });

  it("does not warn when every link of the module stays inside its folder", async () => {
    const warn = sinon.stub(Logging.Channel.prototype, "Warn");
    linkDependency("a", path.join(folder, "vendor", "a"));

    await placeSecond();

    expect(warn.called).to.equal(false);
  });
});
