import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const PROJECT_ENV_FILE = ".env";

const ENV_ENCODING = "utf-8";

const MISSING_FILE_ERROR_CODE = "ENOENT";

const loadedFromEnvFile = new Map<string, string>();

function isMissingFileError(error: PromiseRejectedResult["reason"]): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const systemError: NodeJS.ErrnoException = error;
  return systemError.code === MISSING_FILE_ERROR_CODE;
}

function readEnvFile(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, ENV_ENCODING);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function forgetPreviousLoad(): void {
  for (const [name, value] of loadedFromEnvFile) {
    if (process.env[name] === value) {
      delete process.env[name];
    }
  }
  loadedFromEnvFile.clear();
}

export function getProjectEnvPath(projectFolder: string): string {
  return path.join(path.resolve(projectFolder), PROJECT_ENV_FILE);
}

/**
 * Loads the `.env` of the project into `process.env`, in place of what the
 * previous load took from it: a variable the file no longer declares is
 * removed, unless something else has changed it since. A variable the
 * process environment already holds otherwise is never overwritten.
 *
 * @param projectFolder The folder that holds `antelope.config.ts`
 */
export function loadProjectEnv(projectFolder: string): void {
  forgetPreviousLoad();
  const content = readEnvFile(getProjectEnvPath(projectFolder));
  if (content === undefined) {
    return;
  }
  for (const [name, value] of Object.entries(parseEnv(content))) {
    if (value === undefined || process.env[name] !== undefined) {
      continue;
    }
    process.env[name] = value;
    loadedFromEnvFile.set(name, value);
  }
}
