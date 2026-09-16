import { delimiter, join } from "node:path";
import { access, constants } from "node:fs/promises";

import { WINDOWS_PLATFORM } from "./package-manager-name";

const WINDOWS_EXECUTABLE_EXTENSIONS = [".cmd", ".exe", ".bat"];

export type ExecutableLookup = (name: string) => Promise<string | undefined>;

type ExecutablePredicate = (target: string) => Promise<boolean>;

export interface ExecutableLookupOptions {
  path?: string;
  platform?: NodeJS.Platform;
  isExecutable?: ExecutablePredicate;
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

export async function findExecutable(
  name: string,
  options: ExecutableLookupOptions = {},
): Promise<string | undefined> {
  const isExecutable = options.isExecutable ?? nodeIsExecutable;
  const directories = searchDirectories(options.path ?? process.env.PATH ?? "");
  const candidates = executableCandidates(
    name,
    options.platform ?? process.platform,
  );

  for (const directory of directories) {
    for (const candidate of candidates) {
      const executable = join(directory, candidate);
      if (await isExecutable(executable)) {
        return executable;
      }
    }
  }
  return undefined;
}
