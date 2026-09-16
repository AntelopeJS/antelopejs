import { delimiter, join } from "node:path";
import { access, constants } from "node:fs/promises";

const WINDOWS_EXECUTABLE_EXTENSIONS = [".cmd", ".exe", ".bat"];
const WINDOWS_PLATFORM = "win32";

export type ExecutableLookup = (name: string) => Promise<string | undefined>;

function executableCandidates(name: string): string[] {
  if (process.platform !== WINDOWS_PLATFORM) {
    return [name];
  }
  return [
    name,
    ...WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${name}${extension}`),
  ];
}

export async function findExecutable(
  name: string,
): Promise<string | undefined> {
  const directories = (process.env.PATH ?? "").split(delimiter);
  const candidates = executableCandidates(name);

  for (const directory of directories) {
    for (const candidate of candidates) {
      const executable = join(directory, candidate);
      try {
        await access(executable, constants.X_OK);
        return executable;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}
