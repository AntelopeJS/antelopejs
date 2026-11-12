import { expect } from "chai";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { Module } from "../../src/core/modules";
import { ModuleState } from "../../src/types";
import { manifestFixture } from "../helpers/module-fixtures";
import { cleanupTempDir, makeTempDir } from "../helpers/temp";

describe("Module default loader", () => {
  let folder: string;

  beforeEach(() => {
    folder = makeTempDir("ajs-default-loader-");
  });

  afterEach(() => {
    cleanupTempDir(folder);
  });

  function moduleWithMain(name: string, source: string): Module {
    const main = path.join(folder, `${name}.js`);
    writeFileSync(main, source);
    return new Module(manifestFixture({ name, version: "1.0.0", main }));
  }

  it("runs the lifecycle callbacks a module main exports", async () => {
    const mod = moduleWithMain(
      "exports-callbacks",
      "exports.construct = (config) => { throw new Error('constructed with port ' + config.port); };",
    );

    const failure = await mod.construct({ port: 1 }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(String(failure)).to.contain("constructed with port 1");
  });

  it("calls a lifecycle callback on the module main", async () => {
    const mod = moduleWithMain(
      "exports-receiver",
      "exports.marker = 'module main'; exports.construct = function () { if (this.marker !== 'module main') throw new Error('called on another receiver'); };",
    );

    await mod.construct({});

    expect(mod.state).to.equal(ModuleState.Constructed);
  });

  it("reads the callbacks of a function main marked __esModule", async () => {
    const mod = moduleWithMain(
      "function-main",
      "module.exports = function main() {}; module.exports.__esModule = true; module.exports.construct = () => { throw new Error('function main constructed'); };",
    );

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(String(failure)).to.contain("function main constructed");
  });

  it("skips a null lifecycle callback", async () => {
    const mod = moduleWithMain(
      "null-callbacks",
      "exports.provide = null; exports.construct = null; exports.start = null; exports.stop = null; exports.destroy = null;",
    );

    const published = await mod.provide({});
    await mod.construct({});
    await mod.start();
    await mod.stop();
    await mod.destroy();

    expect(published).to.equal(undefined);
    expect(mod.state).to.equal(ModuleState.Loaded);
  });

  it("skips a false stop callback", async () => {
    const mod = moduleWithMain("false-stop", "exports.stop = false;");

    await mod.construct({});
    await mod.start();
    await mod.stop();

    expect(mod.state).to.equal(ModuleState.Constructed);
  });

  it("loads a truthy non-function callback and fails it when its phase runs", async () => {
    const mod = moduleWithMain("string-start", "exports.start = 'ready';");

    await mod.construct({});
    const failure = await mod.start().then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.be.instanceOf(TypeError);
    expect(String(failure)).to.contain(
      "this.callbacks?.start is not a function",
    );
  });

  it("fails a false callback that only stop would skip", async () => {
    const mod = moduleWithMain("false-start", "exports.start = false;");

    await mod.construct({});
    const failure = await mod.start().then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.be.instanceOf(TypeError);
  });
});
