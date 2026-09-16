import { expect } from "chai";

import { delegateToPlugin } from "../../../src/core/cli/plugin";
import {
  createOutput,
  createProcessRunner,
  formatSpawnCalls,
} from "../../helpers/cli-plugins";
import {
  createInstalledReader,
  CORE_VERSION,
  DMS_EXECUTABLE,
} from "../../helpers/official-plugin";

describe("Official plugin installation", () => {
  it("prints the install command and fails when not interactive", async () => {
    const output = createOutput();
    const { runner, calls } = createProcessRunner();

    const result = await delegateToPlugin(["dms"], {
      lookupExecutable: async () => undefined,
      isInteractive: () => false,
      packageManager: "npm",
      processOptions: { processRunner: runner, platform: "linux" },
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
      packageLookup: { reader: createInstalledReader() },
      coreVersion: CORE_VERSION,
      isInteractive: () => true,
      packageManager: "pnpm",
      processOptions: { processRunner: runner, platform: "linux" },
      confirmInstall: async (question) => {
        questions.push(question);
        return true;
      },
      output,
    });

    expect(questions).to.deep.equal([
      "The DMS plugin is not installed. Install @antelopejs/dms-frontend globally now?",
    ]);
    expect(formatSpawnCalls(calls)).to.deep.equal([
      "pnpm add -g @antelopejs/dms-frontend",
      `${DMS_EXECUTABLE} build`,
    ]);
    expect(result).to.deep.equal({ isDelegated: true, exitCode: 7 });
  });

  it("uses the Windows shim when installing on Windows", async () => {
    const output = createOutput();
    const { runner } = createProcessRunner();

    await delegateToPlugin(["dms"], {
      lookupExecutable: async () => undefined,
      isInteractive: () => false,
      packageManager: "npm",
      processOptions: { processRunner: runner, platform: "win32" },
      output,
    });

    expect(output.errors[1]).to.equal(
      "Install it with: npm.cmd install -g @antelopejs/dms-frontend",
    );
  });

  it("stops when the user declines the installation", async () => {
    const output = createOutput();
    const { runner, calls } = createProcessRunner();

    const result = await delegateToPlugin(["dms"], {
      lookupExecutable: async () => undefined,
      isInteractive: () => true,
      packageManager: "yarn",
      processOptions: { processRunner: runner, platform: "linux" },
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
      processOptions: { processRunner: runner, platform: "linux" },
      confirmInstall: async () => true,
      output,
    });

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 1 });
    expect(output.errors).to.deep.equal([
      "Installation failed: npm install -g @antelopejs/dms-frontend",
    ]);
  });

  it("reports when the installed plugin stays out of PATH", async () => {
    const output = createOutput();
    const { runner } = createProcessRunner([0]);

    const result = await delegateToPlugin(["dms"], {
      lookupExecutable: async () => undefined,
      isInteractive: () => true,
      packageManager: "npm",
      processOptions: { processRunner: runner, platform: "linux" },
      confirmInstall: async () => true,
      output,
    });

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 1 });
    expect(output.errors).to.deep.equal([
      "@antelopejs/dms-frontend was installed but ajs-dms is not available in PATH.",
    ]);
  });
});
