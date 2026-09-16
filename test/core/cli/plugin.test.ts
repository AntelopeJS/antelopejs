import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "chai";

import {
  delegateToPlugin,
  type PluginProcess,
} from "../../../src/core/cli/plugin";
import { runCLI } from "../../../src/core/cli";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

interface PluginFixture {
  directory: string;
  output: string;
}

describe("CLI plugin delegation", () => {
  const originalPath = process.env.PATH;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  function createPlugin(exitCode = 0): PluginFixture {
    const directory = makeTempDir();
    temporaryDirectories.push(directory);
    const output = path.join(directory, "args");
    const executable = path.join(directory, "ajs-dms");
    writeFileSync(
      executable,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${output}"\nexit ${exitCode}\n`,
    );
    chmodSync(executable, 0o755);
    process.env.PATH = directory;
    return { directory, output };
  }

  afterEach(() => {
    if (process.env.PATH && process.env.PATH !== originalPath) {
      cleanupTempDir(process.env.PATH);
    }
    temporaryDirectories.splice(0).forEach(cleanupTempDir);
  });

  it("delegates a plugin command and forwards arguments", async () => {
    const plugin = createPlugin();

    const result = await delegateToPlugin(["dms", "deploy", "--region", "eu"]);

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
    expect(readFileSync(plugin.output, "utf8")).to.equal(
      "deploy\n--region\neu\n",
    );
  });

  it("forwards the plugin exit status", async () => {
    createPlugin(23);

    const result = await delegateToPlugin(["dms"]);

    expect(result.exitCode).to.equal(23);
  });

  it("sets the CLI exit status from a delegated plugin", async () => {
    createPlugin(17);
    const originalExitCode = process.exitCode;

    await runCLI(["dms"]);

    expect(process.exitCode).to.equal(17);
    process.exitCode = originalExitCode;
  });

  it("does not delegate when the plugin is missing", async () => {
    const directory = makeTempDir();
    temporaryDirectories.push(directory);
    process.env.PATH = directory;

    try {
      expect(await delegateToPlugin(["dms", "--help"])).to.deep.equal({
        isDelegated: false,
      });
    } finally {
      cleanupTempDir(directory);
    }
  });

  it("does not delegate core help or version arguments", async () => {
    createPlugin();
    const processRunner: PluginProcess = {
      spawn: () => {
        throw new Error("core arguments must not spawn plugins");
      },
    };

    expect(await delegateToPlugin(["--help"], processRunner)).to.deep.equal({
      isDelegated: false,
    });
    expect(await delegateToPlugin(["--version"], processRunner)).to.deep.equal({
      isDelegated: false,
    });
  });
});
