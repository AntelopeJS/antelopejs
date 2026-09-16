import path from "node:path";
import { expect } from "chai";

import { createPackageReader } from "../../helpers/cli-plugins";
import { readPluginPackage } from "../../../src/core/cli/plugin-package";

const PACKAGE_DIRECTORY = "/usr/lib/node_modules/@antelopejs/dms-frontend";
const EXECUTABLE = "/usr/bin/ajs-dms";

describe("Plugin package lookup", () => {
  it("walks up from the resolved binary to the plugin package.json", async () => {
    const reader = createPackageReader(
      {
        [path.join(PACKAGE_DIRECTORY, "package.json")]: JSON.stringify({
          name: "@antelopejs/dms-frontend",
          version: "3.1.0",
        }),
      },
      { [EXECUTABLE]: path.join(PACKAGE_DIRECTORY, "dist/bin/cli.js") },
    );

    const packageJson = await readPluginPackage(EXECUTABLE, { reader });

    expect(packageJson?.version).to.equal("3.1.0");
  });

  it("skips package.json files that do not match the expected name", async () => {
    const reader = createPackageReader(
      {
        [path.join(PACKAGE_DIRECTORY, "dist/package.json")]: JSON.stringify({
          name: "dist-artifacts",
          version: "0.0.0",
        }),
        [path.join(PACKAGE_DIRECTORY, "package.json")]: JSON.stringify({
          name: "@antelopejs/dms-frontend",
          version: "3.1.0",
        }),
      },
      { [EXECUTABLE]: path.join(PACKAGE_DIRECTORY, "dist/cli.js") },
    );

    const packageJson = await readPluginPackage(EXECUTABLE, {
      reader,
      expectedName: "@antelopejs/dms-frontend",
    });

    expect(packageJson?.version).to.equal("3.1.0");
  });

  it("returns undefined when no package.json is reachable", async () => {
    const reader = createPackageReader({});

    expect(await readPluginPackage(EXECUTABLE, { reader })).to.equal(undefined);
  });

  it("falls back to the raw path when realpath fails", async () => {
    const reader = {
      realpath: async () => {
        throw new Error("ENOENT");
      },
      readFile: async (target: string) => {
        if (target === "/usr/bin/package.json") {
          return JSON.stringify({ name: "shim", version: "1.0.0" });
        }
        throw new Error("ENOENT");
      },
    };

    const packageJson = await readPluginPackage(EXECUTABLE, { reader });

    expect(packageJson?.name).to.equal("shim");
  });
});
