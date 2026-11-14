import { expect } from "chai";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { MissingPackageError, Module } from "../../src/core/modules";
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

  it("fails a truthy non-function stop with the lifecycle's message", async () => {
    const mod = moduleWithMain("string-stop", "exports.stop = 'halt';");

    await mod.construct({});
    await mod.start();
    const failure = await mod.stop().then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(String(failure)).to.contain("this.callbacks.stop is not a function");
  });

  it("calls the callback the module main holds when its phase runs, not the one it held at load", async () => {
    const mod = moduleWithMain(
      "replaced-start",
      "exports.construct = () => { exports.start = () => { throw new Error('replaced start ran'); }; }; exports.start = () => {};",
    );

    await mod.construct({});
    const failure = await mod.start().then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(String(failure)).to.contain("replaced start ran");
  });
});

describe("Module default loader with a missing package", () => {
  let folder: string;

  beforeEach(() => {
    folder = makeTempDir("ajs-missing-package-");
  });

  afterEach(() => {
    cleanupTempDir(folder);
  });

  function moduleRequiring(
    request: string,
    dependencies: Record<string, string>,
  ): Module {
    const main = path.join(folder, "requires-missing.js");
    writeFileSync(main, `require(${JSON.stringify(request)});`);
    return new Module(
      manifestFixture({
        name: "missing-consumer",
        version: "1.0.0",
        main,
        manifest: { name: "missing-consumer", dependencies },
      }),
    );
  }

  it("names the module, the package and the install command when a declared dependency is not installed", async () => {
    const mod = moduleRequiring("ajs-missing-interface", {
      "ajs-missing-interface": "^1.0.0",
    });

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.be.instanceOf(MissingPackageError);
    expect(String(failure)).to.contain(
      "missing-consumer requires ajs-missing-interface, which is not installed. Install the dependencies of missing-consumer, then run 'ajs project modules install'",
    );
  });

  it("names a scoped package required by a subpath", async () => {
    const mod = moduleRequiring("@ajs-missing/interface/sub", {
      "@ajs-missing/interface": "^1.0.0",
    });

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.be.instanceOf(MissingPackageError);
    expect(failure).to.include({ packageName: "@ajs-missing/interface" });
  });

  it("keeps Node's error for a missing package the module does not declare", async () => {
    const mod = moduleRequiring("ajs-undeclared-package", {});

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).not.to.be.instanceOf(MissingPackageError);
    expect(String(failure)).to.contain(
      "Cannot find module 'ajs-undeclared-package'",
    );
  });
});
