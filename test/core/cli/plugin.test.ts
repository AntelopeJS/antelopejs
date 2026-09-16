import path from "node:path";
import { expect } from "chai";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

import { runCLI } from "../../../src/core/cli";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";
import {
  delegateToPlugin,
  type PluginDelegationDependencies,
} from "../../../src/core/cli/plugin";
import {
  createOutput,
  createPackageReader,
  createProcessRunner,
  type FakeOutput,
} from "../../helpers/cli-plugins";

interface PluginFixture {
  directory: string;
  output: string;
}

const DMS_EXECUTABLE = "/usr/bin/ajs-dms";
const DMS_PACKAGE_JSON = "/usr/lib/node_modules/@antelopejs/dms-frontend";

function packageReaderWithPeer(peerRange?: string) {
  const packageJson: Record<string, unknown> = {
    name: "@antelopejs/dms-frontend",
    version: "1.2.3",
  };
  if (peerRange) {
    packageJson.peerDependencies = { "@antelopejs/core": peerRange };
  }
  return createPackageReader(
    {
      [path.join(DMS_PACKAGE_JSON, "package.json")]:
        JSON.stringify(packageJson),
    },
    { [DMS_EXECUTABLE]: path.join(DMS_PACKAGE_JSON, "dist/cli.js") },
  );
}

function installedDependencies(
  overrides: PluginDelegationDependencies = {},
): PluginDelegationDependencies {
  return {
    lookupExecutable: async () => DMS_EXECUTABLE,
    packageLookup: { reader: packageReaderWithPeer() },
    coreVersion: "1.5.1",
    packageManager: "npm",
    isInteractive: () => false,
    ...overrides,
  };
}

describe("CLI plugin delegation", () => {
  const originalPath = process.env.PATH;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    process.env.PATH = originalPath;
    temporaryDirectories.splice(0).forEach(cleanupTempDir);
  });

  function createPlugin(exitCode = 0, binary = "ajs-dms"): PluginFixture {
    const directory = makeTempDir();
    temporaryDirectories.push(directory);
    const output = path.join(directory, "args");
    const executable = path.join(directory, binary);
    writeFileSync(
      executable,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${output}"\nexit ${exitCode}\n`,
    );
    chmodSync(executable, 0o755);
    process.env.PATH = directory;
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

    expect(result.exitCode).to.equal(0);
    expect(readFileSync(plugin.output, "utf8")).to.equal(
      "--help\n--\n--verbose\n",
    );
  });

  it("propagates a signal termination as a shell exit code", async () => {
    const directory = makeTempDir();
    temporaryDirectories.push(directory);
    const executable = path.join(directory, "ajs-dms");
    writeFileSync(executable, "#!/bin/sh\nkill -TERM $$\n");
    chmodSync(executable, 0o755);
    process.env.PATH = directory;

    const result = await delegateToPlugin(["dms"]);

    expect(result.exitCode).to.equal(143);
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
      await delegateToPlugin(["--help"], { processRunner: runner }),
    ).to.deep.equal({ isDelegated: false });
    expect(
      await delegateToPlugin(["--version"], { processRunner: runner }),
    ).to.deep.equal({ isDelegated: false });
    expect(calls).to.deep.equal([]);
  });

  describe("official plugin installation", () => {
    it("prints the install command and fails when not interactive", async () => {
      const output: FakeOutput = createOutput();
      const { runner, calls } = createProcessRunner();

      const result = await delegateToPlugin(["dms"], {
        lookupExecutable: async () => undefined,
        isInteractive: () => false,
        packageManager: "npm",
        processRunner: runner,
        output,
      });

      expect(result).to.deep.equal({ isDelegated: true, exitCode: 1 });
      expect(calls).to.deep.equal([]);
      expect(output.errors).to.deep.equal([
        "The DMS plugin is not installed.",
        "Install it with: npm install -g @antelopejs/dms-frontend",
      ]);
    });

    it("prompts, installs and delegates when interactive", async () => {
      const output = createOutput();
      const { runner, calls } = createProcessRunner([0, 7]);
      const questions: string[] = [];
      let lookupCount = 0;

      const result = await delegateToPlugin(["dms", "build"], {
        lookupExecutable: async () => {
          lookupCount += 1;
          return lookupCount === 1 ? undefined : DMS_EXECUTABLE;
        },
        packageLookup: { reader: packageReaderWithPeer() },
        coreVersion: "1.5.1",
        isInteractive: () => true,
        packageManager: "pnpm",
        processRunner: runner,
        confirmInstall: async (question) => {
          questions.push(question);
          return true;
        },
        output,
      });

      expect(questions).to.deep.equal([
        "The DMS plugin is not installed. Install @antelopejs/dms-frontend globally now?",
      ]);
      expect(calls).to.deep.equal([
        { executable: "pnpm", args: ["add", "-g", "@antelopejs/dms-frontend"] },
        { executable: DMS_EXECUTABLE, args: ["build"] },
      ]);
      expect(result).to.deep.equal({ isDelegated: true, exitCode: 7 });
    });

    it("stops when the user declines the installation", async () => {
      const output = createOutput();
      const { runner, calls } = createProcessRunner();

      const result = await delegateToPlugin(["dms"], {
        lookupExecutable: async () => undefined,
        isInteractive: () => true,
        packageManager: "yarn",
        processRunner: runner,
        confirmInstall: async () => false,
        output,
      });

      expect(result).to.deep.equal({ isDelegated: true, exitCode: 1 });
      expect(calls).to.deep.equal([]);
      expect(output.errors).to.deep.equal([
        "Install it with: yarn global add @antelopejs/dms-frontend",
      ]);
    });

    it("reports a failed installation", async () => {
      const output = createOutput();
      const { runner } = createProcessRunner([1]);

      const result = await delegateToPlugin(["dms"], {
        lookupExecutable: async () => undefined,
        isInteractive: () => true,
        packageManager: "npm",
        processRunner: runner,
        confirmInstall: async () => true,
        output,
      });

      expect(result).to.deep.equal({ isDelegated: true, exitCode: 1 });
      expect(output.errors).to.deep.equal([
        "Installation failed: npm install -g @antelopejs/dms-frontend",
      ]);
    });
  });

  describe("peer compatibility", () => {
    it("delegates when the peer range is satisfied", async () => {
      const { runner, calls } = createProcessRunner([0]);

      const result = await delegateToPlugin(
        ["dms", "status"],
        installedDependencies({
          packageLookup: { reader: packageReaderWithPeer("^1.5.0") },
          processRunner: runner,
        }),
      );

      expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
      expect(calls).to.deep.equal([
        { executable: DMS_EXECUTABLE, args: ["status"] },
      ]);
    });

    it("fails when the peer range excludes the running core", async () => {
      const output = createOutput();
      const { runner, calls } = createProcessRunner();

      const result = await delegateToPlugin(
        ["dms"],
        installedDependencies({
          packageLookup: { reader: packageReaderWithPeer(">=2.0.0") },
          processRunner: runner,
          output,
        }),
      );

      expect(result).to.deep.equal({ isDelegated: true, exitCode: 1 });
      expect(calls).to.deep.equal([]);
      expect(output.errors[0]).to.equal(
        "The DMS plugin is not compatible with this CLI.",
      );
      expect(output.errors[1]).to.contain("@antelopejs/dms-frontend@1.2.3");
      expect(output.errors[1]).to.contain("@antelopejs/core@>=2.0.0");
      expect(output.errors[1]).to.contain("@antelopejs/core@1.5.1");
      expect(output.errors[2]).to.contain("ajs update");
    });

    it("skips the check when the plugin declares no peer range", async () => {
      const output = createOutput();
      const { runner, calls } = createProcessRunner([0]);

      const result = await delegateToPlugin(
        ["dms"],
        installedDependencies({ processRunner: runner, output }),
      );

      expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
      expect(calls).to.have.length(1);
      expect(output.errors).to.deep.equal([]);
    });

    it("skips the check when no plugin package.json can be read", async () => {
      const { runner, calls } = createProcessRunner([0]);

      const result = await delegateToPlugin(
        ["dms"],
        installedDependencies({
          packageLookup: { reader: createPackageReader({}) },
          processRunner: runner,
        }),
      );

      expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
      expect(calls).to.have.length(1);
    });
  });
});
