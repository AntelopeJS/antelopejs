import { expect } from "chai";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { delegateToPlugin, runCLI } from "../../../src/cli";
import {
  createControllableProcessRunner,
  createOutput,
  createProcessRunner,
} from "../../helpers/cli-plugins";
import {
  DMS_EXECUTABLE,
  installedDependencies,
  pluginPackageJson,
} from "../../helpers/official-plugin";
import {
  recordingScript,
  writeNodeExecutable,
} from "../../helpers/node-executable";
import { cleanupTempDir, makeTempDir, readText } from "../../helpers/temp";

interface PluginFixture {
  executable: string;
  output: string;
}

const ARGUMENT_LINES = ["...process.argv.slice(2)"];

{
  let registerCLIPluginDelegation: (this: Mocha.Suite) => void;

  const originalExitCode = process.exitCode;

  const initializeOriginalPath = () => process.env.PATH;
  let originalPath: ReturnType<typeof initializeOriginalPath>;

  const initializeTemporaryDirectories = () => [];
  let temporaryDirectories: string[];

  function createPluginScript(
    lines: string[],
    binary = "ajs-dms",
    exitCode = 0,
  ): PluginFixture {
    const directory = makeTempDir();
    temporaryDirectories.push(directory);
    const output = path.join(directory, "output");
    writeFileSync(path.join(directory, "package.json"), pluginPackageJson());
    const executable = writeNodeExecutable(
      directory,
      binary,
      recordingScript(output, lines, exitCode),
    );
    process.env.PATH = directory;
    return { executable, output };
  }

  function createPlugin(exitCode = 0, binary = "ajs-dms"): PluginFixture {
    return createPluginScript(ARGUMENT_LINES, binary, exitCode);
  }

  const checkDelegatesAPluginCommandAnd: (this: Mocha.Suite) => void =
    function () {
      it("delegates a plugin command and forwards arguments", async () => {
        const plugin = createPlugin();

        const result = await delegateToPlugin([
          "dms",
          "deploy",
          "--region",
          "eu",
        ]);

        expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
        expect(readText(plugin.output)).to.equal("deploy\n--region\neu\n");
      });

      it("forwards plugin flags verbatim instead of parsing them", async () => {
        const plugin = createPlugin();

        const result = await delegateToPlugin([
          "dms",
          "--help",
          "--",
          "--verbose",
        ]);

        expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
        expect(readText(plugin.output)).to.equal("--help\n--\n--verbose\n");
      });

      it("passes the global options before the plugin name as environment", async () => {
        const plugin = createPluginScript([
          'process.argv.slice(2).join(" ")',
          'process.env.NO_COLOR ?? ""',
          'process.env.ANTELOPEJS_VERBOSE ?? ""',
        ]);

        const result = await delegateToPlugin([
          "--no-color",
          "--verbose=cli,api",
          "dms",
          "dev",
        ]);

        expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
        expect(readText(plugin.output)).to.equal("dev\n1\ncli,api\n");
      });

      it("keeps the inherited environment when global options are given", async () => {
        const { runner, calls } = createProcessRunner();

        await delegateToPlugin(
          ["--verbose", "dms", "build"],
          installedDependencies({
            processOptions: {
              processRunner: runner,
              env: { PATH: "/usr/bin", NO_COLOR: "1" },
            },
          }),
        );

        expect(calls[0].args).to.deep.equal(["build"]);
        expect(calls[0].options.env).to.deep.equal({
          PATH: "/usr/bin",
          NO_COLOR: "1",
          ANTELOPEJS_VERBOSE: "*",
        });
      });

      it("names a third-party plugin given after global options", async () => {
        const plugin = createPlugin(0, "ajs-custom");
        const output = createOutput();

        const result = await delegateToPlugin(["--no-color", "custom", "run"], {
          output,
        });

        expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
        expect(readText(plugin.output)).to.equal("run\n");
        expect(output.infos).to.deep.equal([
          `Running third-party plugin ajs-custom (${plugin.executable})`,
        ]);
      });

      it("propagates a signal termination as a shell exit code", async () => {
        const { runner, spawned, close } = createControllableProcessRunner();

        const result = delegateToPlugin(
          ["dms"],
          installedDependencies({ processOptions: { processRunner: runner } }),
        );
        await spawned;
        close(null, "SIGTERM");

        expect(await result).to.deep.equal({
          isDelegated: true,
          exitCode: 143,
        });
      });

      it("forwards the plugin exit status", async () => {
        createPlugin(23);

        const result = await delegateToPlugin(["dms"]);

        expect(result).to.deep.equal({ isDelegated: true, exitCode: 23 });
      });

      it("sets the CLI exit status from a delegated plugin", async () => {
        createPlugin(17);
        await runCLI(["dms"]);

        expect(process.exitCode).to.equal(17);
      });

      it("delegates unknown commands when their executable exists", async () => {
        const plugin = createPlugin(0, "ajs-custom");

        const result = await delegateToPlugin(["custom", "run"], {
          output: createOutput(),
        });

        expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
        expect(readText(plugin.output)).to.equal("run\n");
      });

      it("announces a third-party plugin before running it", async () => {
        const plugin = createPlugin(0, "ajs-custom");
        const output = createOutput();

        await delegateToPlugin(["custom", "run"], { output });

        expect(output.infos).to.deep.equal([
          `Running third-party plugin ajs-custom (${plugin.executable})`,
        ]);
      });

      it("does not announce an official plugin", async () => {
        createPlugin();
        const output = createOutput();

        await delegateToPlugin(["dms"], { output });

        expect(output.infos).to.deep.equal([]);
      });
    };

  const checkDoesNotDelegateUnknownCommands: (this: Mocha.Suite) => void =
    function () {
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
        expect(
          await delegateToPlugin(["--no-color", "--help"], {
            processOptions: { processRunner: runner },
          }),
        ).to.deep.equal({ isDelegated: false });
        expect(await delegateToPlugin(["--verbose"])).to.deep.equal({
          isDelegated: false,
        });
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
    };

  registerCLIPluginDelegation = () => {
    originalPath = initializeOriginalPath();
    temporaryDirectories = initializeTemporaryDirectories();

    afterEach(() => {
      process.exitCode = originalExitCode;
      process.env.PATH = originalPath;
      temporaryDirectories.splice(0).forEach(cleanupTempDir);
    });

    describe("delegates a plugin command and forwards arguments", function () {
      checkDelegatesAPluginCommandAnd.call(this);
    });

    describe("does not delegate unknown commands without an executable", function () {
      checkDoesNotDelegateUnknownCommands.call(this);
    });
  };

  describe("CLI plugin delegation", function () {
    registerCLIPluginDelegation.call(this);
  });
}
