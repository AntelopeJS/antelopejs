import path from "node:path";

import type { PluginPackageReader } from "../../src/core/cli/plugin-package";
import type { PluginDelegationDependencies } from "../../src/core/cli/plugin";
import { createGlobalRootResolver, createPackageReader } from "./cli-plugins";
import type { ResolvedExecutable } from "../../src/core/cli/executable-lookup";

export const DMS_PACKAGE_NAME = "@antelopejs/dms-frontend";
export const DMS_EXECUTABLE = "/usr/bin/ajs-dms";
export const GLOBAL_ROOT = "/usr/lib/node_modules";
const LOCAL_PROJECT_DIRECTORY = "/home/user/project";
export const DMS_PACKAGE_DIRECTORY = path.join(GLOBAL_ROOT, DMS_PACKAGE_NAME);
export const CORE_VERSION = "1.5.1";

export const GLOBAL_DMS: ResolvedExecutable = {
  path: DMS_EXECUTABLE,
  source: "path",
};

export function globalExecutable(executablePath: string): ResolvedExecutable {
  return { path: executablePath, source: "path" };
}

export function localExecutable(executablePath: string): ResolvedExecutable {
  return { path: executablePath, source: "local" };
}

export interface PluginPackageFixture {
  version?: string;
  peerRange?: string;
}

export function pluginPackageJson(fixture: PluginPackageFixture = {}): string {
  const packageJson: Record<string, unknown> = {
    name: DMS_PACKAGE_NAME,
    version: fixture.version ?? "1.2.3",
  };
  if (fixture.peerRange) {
    packageJson.peerDependencies = { "@antelopejs/core": fixture.peerRange };
  }
  return JSON.stringify(packageJson);
}

export function createInstalledReader(
  fixture: PluginPackageFixture = {},
): PluginPackageReader {
  return createPackageReader(
    {
      [path.join(DMS_PACKAGE_DIRECTORY, "package.json")]:
        pluginPackageJson(fixture),
    },
    { [DMS_EXECUTABLE]: path.join(DMS_PACKAGE_DIRECTORY, "dist", "cli.js") },
  );
}

export const LOCAL_DMS_EXECUTABLE = path.join(
  LOCAL_PROJECT_DIRECTORY,
  "node_modules",
  ".bin",
  "ajs-dms",
);

const LOCAL_PACKAGE_DIRECTORY = path.join(
  LOCAL_PROJECT_DIRECTORY,
  "node_modules",
  DMS_PACKAGE_NAME,
);

export function createLocalReader(
  fixture: PluginPackageFixture = {},
): PluginPackageReader {
  return createPackageReader({
    [path.join(LOCAL_PACKAGE_DIRECTORY, "package.json")]:
      pluginPackageJson(fixture),
  });
}

export function createShimReader(
  fixture: PluginPackageFixture = {},
): PluginPackageReader {
  return createPackageReader({
    [path.join(DMS_PACKAGE_DIRECTORY, "package.json")]:
      pluginPackageJson(fixture),
  });
}

export function installedDependencies(
  overrides: PluginDelegationDependencies = {},
): PluginDelegationDependencies {
  return {
    lookupExecutable: async () => GLOBAL_DMS,
    packageLookup: {
      reader: createInstalledReader(),
      packageManager: "npm",
      resolveGlobalRoot: createGlobalRootResolver(),
    },
    coreVersion: CORE_VERSION,
    packageManager: "npm",
    isInteractive: () => false,
    ...overrides,
  };
}
