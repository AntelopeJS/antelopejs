import { dirname, join } from "node:path";
import { readFile, realpath } from "node:fs/promises";

import type { PackageManagerName } from "./package-manager-name";
import {
  detectGlobalPackageManager,
  nodeGlobalRootResolver,
  type GlobalRootResolver,
} from "./global-package-manager";

const PACKAGE_JSON = "package.json";
const MAX_LOOKUP_DEPTH = 12;

export interface PluginPackageReader {
  realpath(target: string): Promise<string>;
  readFile(target: string): Promise<string>;
}

export interface PluginPackage {
  name?: string;
  version?: string;
  peerDependencies?: Record<string, string>;
}

export interface PluginPackageLookup {
  reader?: PluginPackageReader;
  packageManager?: PackageManagerName;
  resolveGlobalRoot?: GlobalRootResolver;
}

const nodePluginPackageReader: PluginPackageReader = {
  realpath: (target) => realpath(target),
  readFile: (target) => readFile(target, "utf8"),
};

async function readPackageJson(
  directory: string,
  reader: PluginPackageReader,
): Promise<PluginPackage | undefined> {
  try {
    return JSON.parse(await reader.readFile(join(directory, PACKAGE_JSON)));
  } catch {
    return undefined;
  }
}

async function resolveRealPath(
  target: string,
  reader: PluginPackageReader,
): Promise<string> {
  try {
    return await reader.realpath(target);
  } catch {
    return target;
  }
}

async function readPackageFromBinary(
  packageName: string,
  executablePath: string,
  reader: PluginPackageReader,
): Promise<PluginPackage | undefined> {
  let directory = dirname(await resolveRealPath(executablePath, reader));

  for (let depth = 0; depth < MAX_LOOKUP_DEPTH; depth += 1) {
    const packageJson = await readPackageJson(directory, reader);
    if (packageJson?.name === packageName) {
      return packageJson;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
  return undefined;
}

async function readPackageFromGlobalRoot(
  packageName: string,
  lookup: PluginPackageLookup,
  reader: PluginPackageReader,
): Promise<PluginPackage | undefined> {
  const resolveGlobalRoot = lookup.resolveGlobalRoot ?? nodeGlobalRootResolver;
  const globalRoot = await resolveGlobalRoot(
    lookup.packageManager ?? detectGlobalPackageManager(),
  );
  if (!globalRoot) {
    return undefined;
  }
  return readPackageJson(join(globalRoot, packageName), reader);
}

export async function resolvePluginPackage(
  packageName: string,
  executablePath: string,
  lookup: PluginPackageLookup = {},
): Promise<PluginPackage | undefined> {
  const reader = lookup.reader ?? nodePluginPackageReader;
  return (
    (await readPackageFromBinary(packageName, executablePath, reader)) ??
    (await readPackageFromGlobalRoot(packageName, lookup, reader))
  );
}
