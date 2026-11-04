import { expect } from "chai";
import path from "node:path";

import type { JsonValue } from "../../helpers/json";
import {
  CORE_PACKAGE_NAME,
  evaluatePluginCompatibility,
  resolvePluginPackage,
} from "../../../src/cli";
import {
  createGlobalRootResolver,
  createPackageReader,
} from "../../helpers/cli-plugins";
import {
  createInstalledReader,
  createLocalReader,
  createShimReader,
  DMS_EXECUTABLE,
  DMS_PACKAGE_DIRECTORY,
  DMS_PACKAGE_NAME,
  GLOBAL_DMS,
  GLOBAL_ROOT,
  globalExecutable,
  LOCAL_DMS_EXECUTABLE,
  localExecutable,
  pluginPackageJson,
} from "../../helpers/official-plugin";

describe("Plugin package resolution", () => {
  it("walks up from the resolved binary to the plugin package.json", async () => {
    const packageJson = await resolvePluginPackage(
      DMS_PACKAGE_NAME,
      GLOBAL_DMS,
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
      GLOBAL_DMS,
      { reader },
    );

    expect(packageJson?.version).to.equal("3.1.0");
  });

  it("falls back to the global root when the binary is a shim", async () => {
    const packageJson = await resolvePluginPackage(
      DMS_PACKAGE_NAME,
      globalExecutable("/home/user/.local/share/pnpm/ajs-dms"),
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
      GLOBAL_DMS,
      {
        reader: createPackageReader({}),
        resolveGlobalRoot: createGlobalRootResolver(),
      },
    );

    expect(packageJson).to.equal(undefined);
  });

  it("resolves a package-manager shim through the project node_modules", async () => {
    const packageJson = await resolvePluginPackage(
      DMS_PACKAGE_NAME,
      localExecutable(LOCAL_DMS_EXECUTABLE),
      { reader: createLocalReader({ version: "1.4.0" }) },
    );

    expect(packageJson?.version).to.equal("1.4.0");
  });

  it("never falls back to the global root for a local binary", async () => {
    const packageJson = await resolvePluginPackage(
      DMS_PACKAGE_NAME,
      localExecutable("/project/node_modules/.bin/ajs-dms"),
      {
        reader: createShimReader({ version: "4.2.0" }),
        packageManager: "pnpm",
        resolveGlobalRoot: createGlobalRootResolver(GLOBAL_ROOT),
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
      GLOBAL_DMS,
      { reader, resolveGlobalRoot: createGlobalRootResolver() },
    );

    expect(packageJson?.version).to.equal("5.0.0");
  });
});

function manifest(fields: Record<string, JsonValue>): string {
  return JSON.stringify({ name: DMS_PACKAGE_NAME, ...fields });
}

describe("Plugin package resolution of malformed documents", () => {
  async function resolveDocument(document: string) {
    return resolvePluginPackage(DMS_PACKAGE_NAME, GLOBAL_DMS, {
      reader: createPackageReader(
        {
          [path.join(DMS_PACKAGE_DIRECTORY, "package.json")]: document,
        },
        {
          [DMS_EXECUTABLE]: path.join(DMS_PACKAGE_DIRECTORY, "dist", "cli.js"),
        },
      ),
      resolveGlobalRoot: createGlobalRootResolver(),
    });
  }

  it("keeps the package and drops a version that is not a string", async () => {
    const packageJson = await resolveDocument(manifest({ version: 4 }));

    expect(packageJson?.name).to.equal(DMS_PACKAGE_NAME);
    expect(packageJson?.version).to.equal(undefined);
  });

  it("still blocks an incompatible plugin whose version is not a string", async () => {
    const packageJson = await resolveDocument(
      manifest({
        version: 4,
        peerDependencies: { [CORE_PACKAGE_NAME]: "^99.0.0" },
      }),
    );

    expect(evaluatePluginCompatibility(packageJson, "1.5.1")).to.include({
      status: "incompatible",
      requiredRange: "^99.0.0",
    });
  });

  it("drops peer ranges that are not strings when they are not the core's", async () => {
    const packageJson = await resolveDocument(
      manifest({
        peerDependencies: { react: 18, [CORE_PACKAGE_NAME]: "^99.0.0" },
      }),
    );

    expect(packageJson?.peerDependencies).to.deep.equal({
      [CORE_PACKAGE_NAME]: "^99.0.0",
    });
  });

  const nonObjectPeerDependencies: Array<[string, JsonValue]> = [
    ["null", null],
    ["a string", "react"],
    ["an array", ["react"]],
    ["a number", 3],
  ];
  for (const [label, peerDependencies] of nonObjectPeerDependencies) {
    it(`reads peerDependencies holding ${label} as absent`, async () => {
      const packageJson = await resolveDocument(manifest({ peerDependencies }));

      expect(evaluatePluginCompatibility(packageJson, "1.5.1")).to.deep.equal({
        status: "compatible",
      });
    });
  }

  it("treats a package.json whose core peer range is not a string as unreadable", async () => {
    const packageJson = await resolveDocument(
      manifest({ peerDependencies: { [CORE_PACKAGE_NAME]: 1 } }),
    );

    expect(packageJson).to.equal(undefined);
  });

  it("does not take a package.json whose name is not a string for the plugin", async () => {
    const packageJson = await resolveDocument(JSON.stringify({ name: 7 }));

    expect(packageJson).to.equal(undefined);
  });
});
