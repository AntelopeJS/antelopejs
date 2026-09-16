import path from "node:path";
import { expect } from "chai";

import {
  createOutput,
  createPackageReader,
  createProcessRunner,
} from "../../helpers/cli-plugins";
import {
  formatPluginStatus,
  getPluginStatuses,
  runUpdate,
} from "../../../src/core/cli/plugin-management";

const DMS_EXECUTABLE = "/usr/bin/ajs-dms";
const DMS_DIRECTORY = "/usr/lib/node_modules/@antelopejs/dms-frontend";

function installedReader(version = "2.0.1") {
  return createPackageReader(
    {
      [path.join(DMS_DIRECTORY, "package.json")]: JSON.stringify({
        name: "@antelopejs/dms-frontend",
        version,
      }),
    },
    { [DMS_EXECUTABLE]: path.join(DMS_DIRECTORY, "dist/cli.js") },
  );
}

describe("Plugin management", () => {
  describe("statuses", () => {
    it("reports an installed plugin with its version", async () => {
      const statuses = await getPluginStatuses({
        lookupExecutable: async () => DMS_EXECUTABLE,
        packageLookup: { reader: installedReader() },
      });

      expect(statuses).to.have.length(1);
      expect(statuses[0].plugin.name).to.equal("dms");
      expect(statuses[0].executablePath).to.equal(DMS_EXECUTABLE);
      expect(statuses[0].version).to.equal("2.0.1");
      expect(formatPluginStatus(statuses[0])).to.contain("installed (2.0.1)");
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

  describe("update", () => {
    it("updates the core and installed plugins", async () => {
      const { runner, calls } = createProcessRunner([0, 0]);
      const output = createOutput();

      const exitCode = await runUpdate(undefined, {
        lookupExecutable: async () => DMS_EXECUTABLE,
        packageLookup: { reader: installedReader() },
        packageManager: "npm",
        processRunner: runner,
        output,
      });

      expect(exitCode).to.equal(0);
      expect(calls).to.deep.equal([
        {
          executable: "npm",
          args: ["install", "-g", "@antelopejs/core@latest"],
        },
        {
          executable: "npm",
          args: ["install", "-g", "@antelopejs/dms-frontend@latest"],
        },
      ]);
      expect(output.infos).to.deep.equal([
        "Running: npm install -g @antelopejs/core@latest",
        "Running: npm install -g @antelopejs/dms-frontend@latest",
      ]);
    });

    it("updates only the core when no plugin is installed", async () => {
      const { runner, calls } = createProcessRunner([0]);

      const exitCode = await runUpdate(undefined, {
        lookupExecutable: async () => undefined,
        packageManager: "pnpm",
        processRunner: runner,
        output: createOutput(),
      });

      expect(exitCode).to.equal(0);
      expect(calls).to.deep.equal([
        { executable: "pnpm", args: ["add", "-g", "@antelopejs/core@latest"] },
      ]);
    });

    it("updates a single plugin by name", async () => {
      const { runner, calls } = createProcessRunner([0]);

      const exitCode = await runUpdate("dms", {
        packageManager: "yarn",
        processRunner: runner,
        output: createOutput(),
      });

      expect(exitCode).to.equal(0);
      expect(calls).to.deep.equal([
        {
          executable: "yarn",
          args: ["global", "add", "@antelopejs/dms-frontend@latest"],
        },
      ]);
    });

    it("rejects unknown plugin names", async () => {
      const { runner, calls } = createProcessRunner();
      const output = createOutput();

      const exitCode = await runUpdate("unknown", {
        processRunner: runner,
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
        lookupExecutable: async () => DMS_EXECUTABLE,
        packageLookup: { reader: installedReader() },
        packageManager: "npm",
        processRunner: runner,
        output,
      });

      expect(exitCode).to.equal(3);
      expect(calls).to.have.length(1);
      expect(output.errors).to.deep.equal([
        "Update failed: npm install -g @antelopejs/core@latest",
      ]);
    });
  });
});
