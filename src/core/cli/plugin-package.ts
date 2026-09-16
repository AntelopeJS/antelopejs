import { dirname, join } from "node:path";
import { readFile, realpath } from "node:fs/promises";

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

const nodePluginPackageReader: PluginPackageReader = {
  realpath: (target) => realpath(target),
  readFile: (target) => readFile(target, "utf8"),
};

export interface PluginPackageLookup {
  reader?: PluginPackageReader;
  expectedName?: string;
}

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

export async function readPluginPackage(
  executablePath: string,
  lookup: PluginPackageLookup = {},
): Promise<PluginPackage | undefined> {
  const reader = lookup.reader ?? nodePluginPackageReader;
  let directory = dirname(await resolveRealPath(executablePath, reader));

  for (let depth = 0; depth < MAX_LOOKUP_DEPTH; depth += 1) {
    const packageJson = await readPackageJson(directory, reader);
    if (packageJson?.name) {
      if (!lookup.expectedName || packageJson.name === lookup.expectedName) {
        return packageJson;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
  return undefined;
}
