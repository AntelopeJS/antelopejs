import path from "node:path";
import { expect } from "chai";

import type { GlobalInstallation } from "../../../src/core/cli/global-package-manager";
import type { ExecutableSource } from "../../../src/core/cli/executable-lookup";
import {
  describePluginStatus,
  getPluginStatuses,
  renderPluginReports,
  runUpdate,
  type PluginReport,
} from "../../../src/core/cli/plugin-management";
import {
  findOfficialPlugin,
  type OfficialPlugin,
} from "../../../src/core/cli/plugin-registry";
import { createMemoryUi } from "../../helpers/memory-ui";
import {
  createGlobalRootResolver,
  createOutput,
  createPackageReader,
  createProcessRunner,
  formatSpawnCalls,
} from "../../helpers/cli-plugins";
import {
  createInstalledReader,
  createLocalReader,
  createShimReader,
  CORE_VERSION,
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
      coreVersion: CORE_VERSION,
    });

    expect(statuses).to.have.length(1);
    expect(statuses[0].plugin.name).to.equal("dms");
    expect(statuses[0].executablePath).to.equal(DMS_EXECUTABLE);
    expect(statuses[0].version).to.equal("2.0.1");
    expect(statuses[0].source).to.equal("path");
    expect(describePluginStatus(statuses[0])).to.deep.equal({
      name: "dms",
      package: "@antelopejs/dms-frontend",
      description: "DMS frontend commands",
      state: "compatible",
      source: "global",
      path: DMS_EXECUTABLE,
      version: "2.0.1",
      requiredCoreRange: null,
    });
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
    expect(describePluginStatus(statuses[0]).source).to.equal("local");
  });

  it("reports a plugin that does not support the running core", async () => {
    const statuses = await getPluginStatuses({
      lookupExecutable: async () => localExecutable(LOCAL_DMS_EXECUTABLE),
      packageLookup: {
        reader: createLocalReader({ version: "0.9.0", peerRange: "^2.0.0" }),
      },
      coreVersion: CORE_VERSION,
    });

    expect(describePluginStatus(statuses[0])).to.include({
      state: "incompatible",
      version: "0.9.0",
      requiredCoreRange: "^2.0.0",
    });
  });

  it("reports an unknown compatibility when the package.json is unreadable", async () => {
    const statuses = await getPluginStatuses({
      lookupExecutable: async () => GLOBAL_DMS,
      packageLookup: { reader: createPackageReader({}) },
      coreVersion: CORE_VERSION,
    });

    expect(describePluginStatus(statuses[0])).to.include({
      state: "unknown",
      version: null,
    });
  });

  it("reports a missing plugin", async () => {
    const statuses = await getPluginStatuses({
      lookupExecutable: async () => undefined,
    });

    expect(statuses[0].executablePath).to.equal(undefined);
    expect(statuses[0].version).to.equal(undefined);
    expect(describePluginStatus(statuses[0])).to.include({
      state: "not-installed",
      source: null,
      path: null,
      version: null,
    });
  });
});

describe("Official plugin table", () => {
  const compatible = describePluginStatus({
    plugin: findOfficialPlugin("dms") as OfficialPlugin,
    executablePath: DMS_EXECUTABLE,
    source: "path",
    version: "1.0.0",
    compatibility: { status: "compatible" },
  });

  function incompatible(source: ExecutableSource): PluginReport {
    return describePluginStatus({
      plugin: findOfficialPlugin("dms") as OfficialPlugin,
      executablePath: path.join(process.cwd(), "node_modules/.bin/ajs-dms"),
      source,
      version: "0.9.0",
      compatibility: { status: "incompatible", requiredRange: "^2.0.0" },
    });
  }

  it("aligns plugins with their compatibility on a terminal", () => {
    const { ui, result, feedback } = createMemoryUi({ isTerminal: true });

    renderPluginReports([compatible], ui);

    expect(result.text.split("\n")).to.deep.equal([
      "PLUGIN  PACKAGE                   VERSION  SOURCE  STATUS      LOCATION",
      `dms     @antelopejs/dms-frontend  1.0.0    global  compatible  ${DMS_EXECUTABLE}`,
      "",
    ]);
    expect(feedback.text).to.equal("");
  });

  it("writes tab-separated rows when piped", () => {
    const { ui, result } = createMemoryUi();

    renderPluginReports(
      [
        describePluginStatus({
          plugin: findOfficialPlugin("dms") as OfficialPlugin,
        }),
      ],
      ui,
    );

    expect(result.text).to.equal(
      "dms\t@antelopejs/dms-frontend\t-\t-\tnot installed\t-\n",
    );
  });

  it("flags a project plugin that needs a newer core and how to fix it", () => {
    const { ui, result, feedback } = createMemoryUi();

    renderPluginReports([incompatible("local")], ui);

    expect(result.text.split("\t").slice(3)).to.deep.equal([
      "local",
      "needs @antelopejs/core ^2.0.0",
      `.${path.sep}${path.join("node_modules", ".bin", "ajs-dms")}\n`,
    ]);
    expect(feedback.text).to.equal(
      "→ Update @antelopejs/dms-frontend in this project's package.json\n",
    );
  });

  it("suggests ajs update for a global plugin that needs a newer core", () => {
    const { ui, feedback } = createMemoryUi();

    renderPluginReports([incompatible("path")], ui);

    expect(feedback.text).to.equal("→ Run ajs update dms to update dms\n");
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
