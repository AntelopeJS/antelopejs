import { dirname, join } from "node:path";
import { readFile, realpath } from "node:fs/promises";

import type { PackageManagerName } from "./package-manager-name";
import {
  PATH_EXECUTABLE_SOURCE,
  type ResolvedExecutable,
} from "./executable-lookup";
import {
  detectGlobalPackageManager,
  nodeGlobalRootResolver,
  type GlobalRootResolver,
} from "./global-package-manager";

const PACKAGE_JSON = "package.json";
const NODE_MODULES = "node_modules";
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

async function readPackageFromDirectory(
  packageName: string,
  directory: string,
  reader: PluginPackageReader,
): Promise<PluginPackage | undefined> {
  const own = await readPackageJson(directory, reader);
  if (own?.name === packageName) {
    return own;
  }
  const installed = await readPackageJson(
    join(directory, NODE_MODULES, packageName),
    reader,
  );
  return installed?.name === packageName ? installed : undefined;
}

/**
 * Walks up from the binary, accepting either the package the binary lives in
 * (symlinked bin entries) or a `node_modules/<package>` sibling of the
 * directory holding the binary (package-manager shims such as pnpm's).
 */
async function readPackageFromBinary(
  packageName: string,
  executablePath: string,
  reader: PluginPackageReader,
): Promise<PluginPackage | undefined> {
  let directory = dirname(await resolveRealPath(executablePath, reader));

  for (let depth = 0; depth < MAX_LOOKUP_DEPTH; depth += 1) {
    const packageJson = await readPackageFromDirectory(
      packageName,
      directory,
      reader,
    );
    if (packageJson) {
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

/**
 * Reads the package.json of the package the resolved binary belongs to. The
 * global installation root is only consulted for a binary that came from
 * `PATH`, so a project-local plugin never reports the globally installed
 * version.
 */
export async function resolvePluginPackage(
  packageName: string,
  executable: ResolvedExecutable,
  lookup: PluginPackageLookup = {},
): Promise<PluginPackage | undefined> {
  const reader = lookup.reader ?? nodePluginPackageReader;
  const fromBinary = await readPackageFromBinary(
    packageName,
    executable.path,
    reader,
  );
  if (fromBinary || executable.source !== PATH_EXECUTABLE_SOURCE) {
    return fromBinary;
  }
  return readPackageFromGlobalRoot(packageName, lookup, reader);
}
