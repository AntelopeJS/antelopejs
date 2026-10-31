import { expect } from "chai";
import path from "node:path";
import * as ts from "typescript";

const TEST_FOLDER = path.resolve(__dirname, "..");
const SOURCE_FOLDER = path.resolve(TEST_FOLDER, "..", "src");
const CONSUMER_FILE = path.join(TEST_FOLDER, "package-consumer", "verify.cjs");

function testCompilerOptions(): ts.CompilerOptions {
  const configFile = path.join(TEST_FOLDER, "tsconfig.json");
  const read = ts.readConfigFile(configFile, (file) => ts.sys.readFile(file));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, TEST_FOLDER)
    .options;
}

function resolvedFile(specifier: string): string | undefined {
  return ts.resolveModuleName(
    specifier,
    CONSUMER_FILE,
    testCompilerOptions(),
    ts.sys,
  ).resolvedModule?.resolvedFileName;
}

describe("package consumer scripts", () => {
  it("type the core entry from its source, so their lint findings do not depend on a build", () => {
    expect(resolvedFile("@antelopejs/core")).to.equal(
      path.join(SOURCE_FOLDER, "index.ts"),
    );
  });

  it("type the core CLI entry from its source, so their lint findings do not depend on a build", () => {
    expect(resolvedFile("@antelopejs/core/cli")).to.equal(
      path.join(SOURCE_FOLDER, "core", "cli", "public.ts"),
    );
  });
});
