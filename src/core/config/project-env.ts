import { Logging } from "@antelopejs/interface-core/logging";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const PROJECT_ENV_FILE = ".env";

const ENV_ENCODING = "utf-8";

const MISSING_FILE_ERROR_CODE = "ENOENT";

const Logger = new Logging.Channel("loader.env");

/** What the last load of one `.env` did to `process.env`. */
interface ProjectEnvLoad {
  /** The variables it set, with the value it set each to. */
  loaded: Map<string, string>;
  /** The names it declares that the process environment already held. */
  kept: string[];
  /** Whether {@link logProjectEnv} has logged it. */
  logged: boolean;
}

const loadsByEnvFile = new Map<string, ProjectEnvLoad>();

function readEnvFile(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, ENV_ENCODING);
  } catch (error) {
    if (error instanceof Error) {
      const systemError: NodeJS.ErrnoException = error;
      if (systemError.code === MISSING_FILE_ERROR_CODE) {
        return undefined;
      }
    }
    throw error;
  }
}

function forgetPreviousLoad(envPath: string): ProjectEnvLoad {
  for (const [name, value] of loadsByEnvFile.get(envPath)?.loaded ?? []) {
    if (process.env[name] === value) {
      delete process.env[name];
    }
  }
  const load: ProjectEnvLoad = { loaded: new Map(), kept: [], logged: false };
  loadsByEnvFile.set(envPath, load);
  return load;
}

export function getProjectEnvPath(projectFolder: string): string {
  return path.join(path.resolve(projectFolder), PROJECT_ENV_FILE);
}

/**
 * Loads the `.env` of the project into `process.env`, in place of what the
 * previous load of the same file took from it: a variable it no longer declares is
 * removed, unless something else has changed it since. A variable the
 * process environment already holds otherwise is never overwritten.
 *
 * @param projectFolder The folder that holds `antelope.config.ts`
 */
export function loadProjectEnv(projectFolder: string): void {
  const envPath = getProjectEnvPath(projectFolder);
  const load = forgetPreviousLoad(envPath);
  const content = readEnvFile(envPath);
  if (content === undefined) {
    return;
  }
  for (const [name, value] of Object.entries(parseEnv(content))) {
    if (value === undefined) {
      continue;
    }
    if (process.env[name] !== undefined) {
      load.kept.push(name);
      continue;
    }
    process.env[name] = value;
    load.loaded.set(name, value);
  }
}

/**
 * Logs, on the debug level of the `loader.env` channel, the names of the
 * variables the last {@link loadProjectEnv} of the project set from its
 * `.env`, and of those it left as the process environment held them, each
 * list in alphabetical order. It never logs a value, and logs each load once.
 * Called once logging is set up, since the `.env` is loaded before the
 * `--verbose` channels apply.
 *
 * @param projectFolder The folder that holds `antelope.config.ts`
 */
export function logProjectEnv(projectFolder: string): void {
  const envPath = getProjectEnvPath(projectFolder);
  const load = loadsByEnvFile.get(envPath);
  if (load === undefined || load.logged) {
    return;
  }
  load.logged = true;
  if (load.loaded.size > 0) {
    Logger.Debug(
      `Loaded from ${envPath}: ${[...load.loaded.keys()].sort().join(", ")}`,
    );
  }
  if (load.kept.length > 0) {
    Logger.Debug(
      `Kept from the environment, not ${envPath}: ${[...load.kept].sort().join(", ")}`,
    );
  }
}

/**
 * `env` without the variables a {@link loadProjectEnv} of this process set
 * and nothing changed since, for a child process that loads the `.env` of the
 * project itself and must tell them from the ones its parent was started with.
 */
export function withoutProjectEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const filtered = { ...env };
  for (const { loaded } of loadsByEnvFile.values()) {
    for (const [name, value] of loaded) {
      if (filtered[name] === value) {
        delete filtered[name];
      }
    }
  }
  return filtered;
}
