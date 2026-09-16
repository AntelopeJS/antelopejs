import path from "node:path";
import { expect } from "chai";

import { resolvePluginPackage } from "../../../src/core/cli/plugin-package";
import {
  createGlobalRootResolver,
  createPackageReader,
} from "../../helpers/cli-plugins";
import {
  createInstalledReader,
  createShimReader,
  DMS_EXECUTABLE,
  DMS_PACKAGE_DIRECTORY,
  DMS_PACKAGE_NAME,
  GLOBAL_ROOT,
  pluginPackageJson,
} from "../../helpers/official-plugin";

describe("Plugin package resolution", () => {
  it("walks up from the resolved binary to the plugin package.json", async () => {
    const packageJson = await resolvePluginPackage(
      DMS_PACKAGE_NAME,
      DMS_EXECUTABLE,
      { reader: createInstalledReader({ version: "3.1.0" }) },
    );

    expect(packageJson?.version).to.equal("3.1.0");
  });

  it("skips package.json files that do not belong to the plugin", async () => {
    const reader = createPackageReader(
      {
        [path.join(DMS_PACKAGE_DIRECTORY, "dist", "package.json")]:
          JSON.stringify({ name: "dist-artifacts", version: "0.0.0" }),
        [path.join(DMS_PACKAGE_DIRECTORY, "package.json")]: pluginPackageJson({
          version: "3.1.0",
        }),
      },
      { [DMS_EXECUTABLE]: path.join(DMS_PACKAGE_DIRECTORY, "dist", "cli.js") },
    );

    const packageJson = await resolvePluginPackage(
      DMS_PACKAGE_NAME,
      DMS_EXECUTABLE,
      { reader },
    );

    expect(packageJson?.version).to.equal("3.1.0");
  });

  it("falls back to the global root when the binary is a shim", async () => {
    const packageJson = await resolvePluginPackage(
      DMS_PACKAGE_NAME,
      "/home/user/.local/share/pnpm/ajs-dms",
      {
        reader: createShimReader({ version: "4.2.0" }),
        packageManager: "pnpm",
        resolveGlobalRoot: createGlobalRootResolver(GLOBAL_ROOT),
      },
    );

    expect(packageJson?.version).to.equal("4.2.0");
  });

  it("returns undefined when neither the binary nor the global root resolve", async () => {
    const packageJson = await resolvePluginPackage(
      DMS_PACKAGE_NAME,
      DMS_EXECUTABLE,
      {
        reader: createPackageReader({}),
        resolveGlobalRoot: createGlobalRootResolver(),
      },
    );

    expect(packageJson).to.equal(undefined);
  });

  it("falls back to the raw path when realpath fails", async () => {
    const reader = {
      realpath: async () => {
        throw new Error("ENOENT");
      },
      readFile: async (target: string) => {
        if (target === path.join("/usr/bin", "package.json")) {
          return pluginPackageJson({ version: "5.0.0" });
        }
        throw new Error("ENOENT");
      },
    };

    const packageJson = await resolvePluginPackage(
      DMS_PACKAGE_NAME,
      DMS_EXECUTABLE,
      { reader, resolveGlobalRoot: createGlobalRootResolver() },
    );

    expect(packageJson?.version).to.equal("5.0.0");
  });
});
