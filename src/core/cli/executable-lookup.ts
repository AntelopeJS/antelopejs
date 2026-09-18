import { delimiter, dirname, join } from "node:path";
import { access, constants } from "node:fs/promises";

import { WINDOWS_PLATFORM } from "./package-manager-name";

const WINDOWS_EXECUTABLE_EXTENSIONS = [".cmd", ".exe", ".bat"];
const NODE_MODULES_BIN = join("node_modules", ".bin");

export const LOCAL_EXECUTABLE_SOURCE = "local";
export const PATH_EXECUTABLE_SOURCE = "path";

export type ExecutableSource =
  | typeof LOCAL_EXECUTABLE_SOURCE
  | typeof PATH_EXECUTABLE_SOURCE;

export interface ResolvedExecutable {
  path: string;
  source: ExecutableSource;
}

export type ExecutableLookup = (
  name: string,
) => Promise<ResolvedExecutable | undefined>;

type ExecutablePredicate = (target: string) => Promise<boolean>;

export interface ExecutableLookupOptions {
  cwd?: string;
  path?: string;
  platform?: NodeJS.Platform;
  isExecutable?: ExecutablePredicate;
}

interface ExecutableLookupInputs {
  isExecutable: ExecutablePredicate;
  candidates: string[];
}

const nodeIsExecutable: ExecutablePredicate = async (target) => {
  try {
    await access(target, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

function executableCandidates(
  name: string,
  platform: NodeJS.Platform,
): string[] {
  if (platform !== WINDOWS_PLATFORM) {
    return [name];
  }
  return [
    name,
    ...WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${name}${extension}`),
  ];
}

function searchDirectories(path: string): string[] {
  return path.split(delimiter).filter((directory) => directory.length > 0);
}

function localBinDirectories(cwd: string): string[] {
  const directories: string[] = [];
  let current = cwd;
  let parent = dirname(current);

  while (parent !== current) {
    directories.push(join(current, NODE_MODULES_BIN));
    current = parent;
    parent = dirname(current);
  }
  directories.push(join(current, NODE_MODULES_BIN));
  return directories;
}

async function findInDirectories(
  directories: string[],
  inputs: ExecutableLookupInputs,
): Promise<string | undefined> {
  for (const directory of directories) {
    for (const candidate of inputs.candidates) {
      const executable = join(directory, candidate);
      if (await inputs.isExecutable(executable)) {
        return executable;
      }
    }
  }
  return undefined;
}

function lookupInputs(
  name: string,
  options: ExecutableLookupOptions,
): ExecutableLookupInputs {
  return {
    isExecutable: options.isExecutable ?? nodeIsExecutable,
    candidates: executableCandidates(
      name,
      options.platform ?? process.platform,
    ),
  };
}

/**
 * Looks the executable up in `node_modules/.bin` of the working directory and
 * of every parent directory, the way `npx` resolves a project-local binary.
 */
async function findLocalExecutable(
  name: string,
  options: ExecutableLookupOptions = {},
): Promise<string | undefined> {
  return findInDirectories(
    localBinDirectories(options.cwd ?? process.cwd()),
    lookupInputs(name, options),
  );
}

export async function findExecutable(
  name: string,
  options: ExecutableLookupOptions = {},
): Promise<string | undefined> {
  return findInDirectories(
    searchDirectories(options.path ?? process.env.PATH ?? ""),
    lookupInputs(name, options),
  );
}

/**
 * Resolves an executable by preferring the project-local `node_modules/.bin`
 * entry over the one found in `PATH`.
 */
export async function resolveExecutable(
  name: string,
  options: ExecutableLookupOptions = {},
): Promise<ResolvedExecutable | undefined> {
  const local = await findLocalExecutable(name, options);
  if (local) {
    return { path: local, source: LOCAL_EXECUTABLE_SOURCE };
  }
  const fromPath = await findExecutable(name, options);
  if (!fromPath) {
    return undefined;
  }
  return { path: fromPath, source: PATH_EXECUTABLE_SOURCE };
}
