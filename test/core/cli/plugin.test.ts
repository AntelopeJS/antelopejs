import path from "node:path";
import { expect } from "chai";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

import { runCLI } from "../../../src/core/cli";
import { delegateToPlugin } from "../../../src/core/cli/plugin";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";
import {
  DMS_EXECUTABLE,
  installedDependencies,
  pluginPackageJson,
} from "../../helpers/official-plugin";
import {
  createControllableProcessRunner,
  createOutput,
  createProcessRunner,
} from "../../helpers/cli-plugins";

interface PluginFixture {
  directory: string;
  output: string;
}

describe("CLI plugin delegation", () => {
  const originalPath = process.env.PATH;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    process.env.PATH = originalPath;
    temporaryDirectories.splice(0).forEach(cleanupTempDir);
  });

  function createPluginScript(
    buildScript: (directory: string) => string,
    binary: string,
  ): string {
    const directory = makeTempDir();
    temporaryDirectories.push(directory);
    const executable = path.join(directory, binary);
    writeFileSync(executable, buildScript(directory));
    writeFileSync(path.join(directory, "package.json"), pluginPackageJson());
    chmodSync(executable, 0o755);
    process.env.PATH = directory;
    return directory;
  }

  function createPlugin(exitCode = 0, binary = "ajs-dms"): PluginFixture {
    let output = "";
    const directory = createPluginScript((pluginDirectory) => {
      output = path.join(pluginDirectory, "args");
      return `#!/bin/sh\nprintf '%s\\n' "$@" > "${output}"\nexit ${exitCode}\n`;
    }, binary);
    return { directory, output };
  }

  it("delegates a plugin command and forwards arguments", async () => {
    const plugin = createPlugin();

    const result = await delegateToPlugin(["dms", "deploy", "--region", "eu"]);

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
    expect(readFileSync(plugin.output, "utf8")).to.equal(
      "deploy\n--region\neu\n",
    );
  });

  it("forwards plugin flags verbatim instead of parsing them", async () => {
    const plugin = createPlugin();

    const result = await delegateToPlugin(["dms", "--help", "--", "--verbose"]);

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
    expect(readFileSync(plugin.output, "utf8")).to.equal(
      "--help\n--\n--verbose\n",
    );
  });

  it("propagates a signal termination as a shell exit code", async () => {
    createPluginScript(() => "#!/bin/sh\nkill -TERM $$\n", "ajs-dms");

    const result = await delegateToPlugin(["dms"]);

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 143 });
  });

  it("forwards the plugin exit status", async () => {
    createPlugin(23);

    const result = await delegateToPlugin(["dms"]);

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 23 });
  });

  it("sets the CLI exit status from a delegated plugin", async () => {
    createPlugin(17);
    const originalExitCode = process.exitCode;

    await runCLI(["dms"]);

    expect(process.exitCode).to.equal(17);
    process.exitCode = originalExitCode;
  });

  it("delegates unknown commands when their executable exists", async () => {
    const plugin = createPlugin(0, "ajs-custom");

    const result = await delegateToPlugin(["custom", "run"]);

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
    expect(readFileSync(plugin.output, "utf8")).to.equal("run\n");
  });

  it("does not delegate unknown commands without an executable", async () => {
    const directory = makeTempDir();
    temporaryDirectories.push(directory);
    process.env.PATH = directory;

    expect(await delegateToPlugin(["custom", "--help"])).to.deep.equal({
      isDelegated: false,
    });
  });

  it("does not delegate core help or version arguments", async () => {
    createPlugin();
    const { runner, calls } = createProcessRunner();

    expect(
      await delegateToPlugin(["--help"], {
        processOptions: { processRunner: runner },
      }),
    ).to.deep.equal({ isDelegated: false });
    expect(
      await delegateToPlugin(["--version"], {
        processOptions: { processRunner: runner },
      }),
    ).to.deep.equal({ isDelegated: false });
    expect(calls).to.deep.equal([]);
  });

  it("reports a spawn failure without failing the CLI with a stack", async () => {
    const { runner, spawned, fail } = createControllableProcessRunner();
    const output = createOutput();

    const result = delegateToPlugin(
      ["dms", "build"],
      installedDependencies({
        processOptions: { processRunner: runner },
        output,
      }),
    );
    await spawned;
    fail(new Error("spawn ajs-dms EACCES"));

    expect(await result).to.deep.equal({ isDelegated: true, exitCode: 1 });
    expect(output.errors).to.deep.equal([
      `Failed to run ${DMS_EXECUTABLE}: spawn ajs-dms EACCES`,
    ]);
  });
});
