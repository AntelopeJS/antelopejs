import { expect } from "chai";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { Module } from "../../src/core/modules";
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

  it("refuses a module main whose lifecycle callback is not a function", async () => {
    const mod = moduleWithMain(
      "exports-non-function",
      "exports.construct = () => {}; exports.start = 'ready';",
    );

    const failure = await mod.construct({}).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.be.instanceOf(TypeError);
    expect(String(failure)).to.contain("exports-non-function.js");
  });
});
