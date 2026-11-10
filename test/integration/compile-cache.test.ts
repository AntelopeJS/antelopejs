import { expect } from "chai";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { cleanupTempDir, makeTempDir } from "../helpers/temp";

const CLI_ENTRY = path.resolve(__dirname, "../../src/core/cli/index.ts");

describe("ajs compile cache", function () {
  this.timeout(60000);
  let tempFolder = "";

  beforeEach(() => {
    tempFolder = makeTempDir("ajs-compile-cache-");
  });

  afterEach(() => {
    cleanupTempDir(tempFolder);
  });

  it("caches the code it compiles under the temporary folder, for the next command to reuse", () => {
    const { NODE_COMPILE_CACHE: _ignored, ...env } = process.env;

    const result = spawnSync(
      process.execPath,
      ["-r", "ts-node/register", CLI_ENTRY, "--version"],
      {
        cwd: path.resolve(__dirname, "../.."),
        env: { ...env, TMPDIR: tempFolder, TMP: tempFolder, TEMP: tempFolder },
      },
    );

    expect(result.status).to.equal(0);
    expect(existsSync(path.join(tempFolder, "node-compile-cache"))).to.equal(
      true,
    );
  });
});
