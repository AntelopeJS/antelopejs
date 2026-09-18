import { expect } from "chai";

import type { GlobalInstallation } from "../../../src/core/cli/global-package-manager";
import {
  formatPluginStatus,
  getPluginStatuses,
  runUpdate,
} from "../../../src/core/cli/plugin-management";
import {
  createGlobalRootResolver,
  createOutput,
  createProcessRunner,
  formatSpawnCalls,
} from "../../helpers/cli-plugins";
import {
  createInstalledReader,
  createLocalReader,
  createShimReader,
  DMS_EXECUTABLE,
  GLOBAL_DMS,
  GLOBAL_ROOT,
  globalExecutable,
  LOCAL_DMS_EXECUTABLE,
  localExecutable,
} from "../../helpers/official-plugin";

const NPM_INSTALLATION: GlobalInstallation = {
  packageManager: "npm",
  binaryPath: "/usr/lib/node_modules/@antelopejs/core/dist/core/cli/index.js",
};

describe("Official plugin statuses", () => {
  it("reports an installed plugin with its version", async () => {
    const statuses = await getPluginStatuses({
      lookupExecutable: async () => GLOBAL_DMS,
      packageLookup: { reader: createInstalledReader({ version: "2.0.1" }) },
    });

    expect(statuses).to.have.length(1);
    expect(statuses[0].plugin.name).to.equal("dms");
    expect(statuses[0].executablePath).to.equal(DMS_EXECUTABLE);
    expect(statuses[0].version).to.equal("2.0.1");
    expect(statuses[0].source).to.equal("path");
    expect(formatPluginStatus(statuses[0])).to.contain("global (2.0.1)");
  });

  it("reads the version from the global root behind a shim", async () => {
    const statuses = await getPluginStatuses({
      lookupExecutable: async () =>
        globalExecutable("/home/user/.local/share/pnpm/ajs-dms"),
      packageLookup: {
        reader: createShimReader({ version: "3.3.3" }),
        packageManager: "pnpm",
        resolveGlobalRoot: createGlobalRootResolver(GLOBAL_ROOT),
      },
    });

    expect(statuses[0].version).to.equal("3.3.3");
  });

  it("reports a plugin resolved from the project node_modules", async () => {
    const statuses = await getPluginStatuses({
      lookupExecutable: async () => localExecutable(LOCAL_DMS_EXECUTABLE),
      packageLookup: { reader: createLocalReader({ version: "1.4.0" }) },
    });

    expect(statuses[0].source).to.equal("local");
    expect(statuses[0].executablePath).to.equal(LOCAL_DMS_EXECUTABLE);
    expect(statuses[0].version).to.equal("1.4.0");
    expect(formatPluginStatus(statuses[0])).to.contain(
      `local (${LOCAL_DMS_EXECUTABLE}) (1.4.0)`,
    );
  });

  it("reports a missing plugin", async () => {
    const statuses = await getPluginStatuses({
      lookupExecutable: async () => undefined,
    });

    expect(statuses[0].executablePath).to.equal(undefined);
    expect(statuses[0].version).to.equal(undefined);
    expect(formatPluginStatus(statuses[0])).to.contain("not installed");
  });
});

describe("Official plugin update", () => {
  it("updates the core and installed plugins", async () => {
    const { runner, calls } = createProcessRunner([0, 0]);
    const output = createOutput();

    const exitCode = await runUpdate(undefined, {
      detectInstallation: () => NPM_INSTALLATION,
      lookupExecutable: async () => GLOBAL_DMS,
      packageLookup: { reader: createInstalledReader() },
      processOptions: { processRunner: runner, platform: "linux" },
      output,
    });

    expect(exitCode).to.equal(0);
    expect(formatSpawnCalls(calls)).to.deep.equal([
      "npm install -g @antelopejs/core@latest",
      "npm install -g @antelopejs/dms-frontend@latest",
    ]);
    expect(output.infos).to.deep.equal([
      "Running: npm install -g @antelopejs/core@latest",
      "Running: npm install -g @antelopejs/dms-frontend@latest",
    ]);
  });

  it("updates only the core when no plugin is installed", async () => {
    const { runner, calls } = createProcessRunner([0]);

    const exitCode = await runUpdate(undefined, {
      detectInstallation: () => ({
        packageManager: "pnpm",
        binaryPath: "/home/user/.local/share/pnpm/global/5/node_modules/ajs",
      }),
      lookupExecutable: async () => undefined,
      processOptions: { processRunner: runner, platform: "linux" },
      output: createOutput(),
    });

    expect(exitCode).to.equal(0);
    expect(formatSpawnCalls(calls)).to.deep.equal([
      "pnpm add -g @antelopejs/core@latest",
    ]);
  });

  it("leaves a locally resolved plugin to the project package manager", async () => {
    const { runner, calls } = createProcessRunner([0]);

    const exitCode = await runUpdate(undefined, {
      detectInstallation: () => NPM_INSTALLATION,
      lookupExecutable: async () => localExecutable(LOCAL_DMS_EXECUTABLE),
      packageLookup: { reader: createLocalReader() },
      processOptions: { processRunner: runner, platform: "linux" },
      output: createOutput(),
    });

    expect(exitCode).to.equal(0);
    expect(formatSpawnCalls(calls)).to.deep.equal([
      "npm install -g @antelopejs/core@latest",
    ]);
  });

  it("updates a single plugin by name", async () => {
    const { runner, calls } = createProcessRunner([0]);

    const exitCode = await runUpdate("dms", {
      detectInstallation: () => ({
        packageManager: "yarn",
        binaryPath: "/home/user/.config/yarn/global/node_modules/ajs",
      }),
      processOptions: { processRunner: runner, platform: "linux" },
      output: createOutput(),
    });

    expect(exitCode).to.equal(0);
    expect(formatSpawnCalls(calls)).to.deep.equal([
      "yarn global add @antelopejs/dms-frontend@latest",
    ]);
  });

  it("refuses to update a CLI that is not installed globally", async () => {
    const { runner, calls } = createProcessRunner();
    const output = createOutput();

    const exitCode = await runUpdate(undefined, {
      detectInstallation: () => undefined,
      processOptions: { processRunner: runner },
      output,
    });

    expect(exitCode).to.equal(1);
    expect(calls).to.deep.equal([]);
    expect(output.errors[0]).to.equal(
      "ajs is not installed globally; update it in the project instead.",
    );
  });

  it("rejects unknown plugin names", async () => {
    const { runner, calls } = createProcessRunner();
    const output = createOutput();

    const exitCode = await runUpdate("unknown", {
      detectInstallation: () => NPM_INSTALLATION,
      processOptions: { processRunner: runner },
      output,
    });

    expect(exitCode).to.equal(1);
    expect(calls).to.deep.equal([]);
    expect(output.errors).to.deep.equal([
      'Unknown plugin "unknown". Known plugins: dms.',
    ]);
  });

  it("stops and propagates a failing update", async () => {
    const { runner, calls } = createProcessRunner([3]);
    const output = createOutput();

    const exitCode = await runUpdate(undefined, {
      detectInstallation: () => NPM_INSTALLATION,
      lookupExecutable: async () => GLOBAL_DMS,
      packageLookup: { reader: createInstalledReader() },
      processOptions: { processRunner: runner, platform: "linux" },
      output,
    });

    expect(exitCode).to.equal(3);
    expect(calls).to.have.length(1);
    expect(output.errors).to.deep.equal([
      "Update failed: npm install -g @antelopejs/core@latest",
    ]);
  });
});
