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

/**
 * Windows has no execute permission bit, and Node maps `X_OK` to `F_OK` there,
 * so the mode is picked per platform to keep the check meaningful instead of
 * silently degrading to an existence test.
 */
function nodeExecutableMode(platform: NodeJS.Platform): number {
  return platform === WINDOWS_PLATFORM ? constants.F_OK : constants.X_OK;
}

function nodeExecutablePredicate(
  platform: NodeJS.Platform,
): ExecutablePredicate {
  const mode = nodeExecutableMode(platform);
  return async (target) => {
    try {
      await access(target, mode);
      return true;
    } catch {
      return false;
    }
  };
}

function hasWindowsExecutableExtension(name: string): boolean {
  const lowercased = name.toLowerCase();
  return WINDOWS_EXECUTABLE_EXTENSIONS.some((extension) =>
    lowercased.endsWith(extension),
  );
}

/**
 * On Windows the extension carries the executability, so the suffixed
 * candidates come first: package managers also drop an extension-less shell
 * script in `node_modules/.bin` for Git Bash, and `spawn` cannot run it.
 */
function executableCandidates(
  name: string,
  platform: NodeJS.Platform,
): string[] {
  if (platform !== WINDOWS_PLATFORM || hasWindowsExecutableExtension(name)) {
    return [name];
  }
  return [
    ...WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${name}${extension}`),
    name,
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
  const platform = options.platform ?? process.platform;
  return {
    isExecutable: options.isExecutable ?? nodeExecutablePredicate(platform),
    candidates: executableCandidates(name, platform),
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
