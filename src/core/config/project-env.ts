import { Logging } from "@antelopejs/interface-core/logging";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const PROJECT_ENV_FILE = ".env";

const ENV_ENCODING = "utf-8";

const MISSING_FILE_ERROR_CODE = "ENOENT";

const Logger = new Logging.Channel("loader.env");

/** What one load of a `.env` did to `process.env`. */
interface ProjectEnvLoad {
  /** The loads of the same file, this one among them while it counts. */
  readonly fileLoads: ProjectEnvLoad[];
  /**
   * The variables it set that nothing has changed since, with the value it
   * set each to: those it holds while it is in effect.
   */
  readonly loaded: Map<string, string>;
  /** The names it declares that the process environment already held. */
  readonly kept: string[];
  /** Whether {@link logProjectEnv} has logged it. */
  logged: boolean;
  /** Whether the launch that made it may still withdraw it. */
  withdrawable: boolean;
}

/**
 * The loads of each `.env` file, oldest first, from the last one no launch
 * may withdraw: `process.env` holds what the last of them set, and a load
 * withdrawn while in effect gives way to the one before it.
 */
const loadsByEnvFile = new Map<string, ProjectEnvLoad[]>();

const recordedLoads = new AsyncLocalStorage<ProjectEnvLoad[]>();

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

function putOutOfEffect(load: ProjectEnvLoad): void {
  for (const [name, value] of load.loaded) {
    if (process.env[name] === value) {
      delete process.env[name];
    } else {
      load.loaded.delete(name);
    }
  }
}

function putBackInEffect(load: ProjectEnvLoad): void {
  for (const [name, value] of load.loaded) {
    if (process.env[name] === undefined) {
      process.env[name] = value;
    } else {
      load.loaded.delete(name);
    }
  }
}

function dropSupersededLoads(loads: ProjectEnvLoad[]): void {
  let lastKept = loads.length - 1;
  while (lastKept > 0 && loads[lastKept].withdrawable) {
    lastKept -= 1;
  }
  loads.splice(0, lastKept);
}

function withdrawLoad(load: ProjectEnvLoad): void {
  const loads = load.fileLoads;
  const index = loads.indexOf(load);
  if (index === -1) {
    return;
  }
  loads.splice(index, 1);
  if (index === loads.length) {
    putOutOfEffect(load);
    const previous = loads.at(-1);
    if (previous !== undefined) {
      putBackInEffect(previous);
    }
  }
}

export function getProjectEnvPath(projectFolder: string): string {
  return path.join(path.resolve(projectFolder), PROJECT_ENV_FILE);
}

/**
 * The loads of project `.env` files one launch makes while it prepares, so
 * that a launch interrupted meanwhile undoes them without touching what
 * another launch of the same project loaded.
 */
export class LaunchEnvLoads {
  private readonly loads: ProjectEnvLoad[] = [];

  /** Runs `prepare`, recording the {@link loadProjectEnv} calls it makes. */
  record<Result>(prepare: () => Result): Result {
    return recordedLoads.run(this.loads, prepare);
  }

  /**
   * Undoes the recorded loads. A load still in effect removes the variables
   * it set and nothing has changed since, then gives way to the load it
   * replaced, which sets again those of its variables it removed and nothing
   * has set since. A load another has replaced is only forgotten.
   */
  withdraw(): void {
    for (const load of this.loads) {
      withdrawLoad(load);
    }
  }

  /** Makes the recorded loads permanent: {@link withdraw} no longer applies. */
  keep(): void {
    for (const load of this.loads) {
      load.withdrawable = false;
      dropSupersededLoads(load.fileLoads);
    }
  }
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
  const loads = loadsByEnvFile.get(envPath) ?? [];
  loadsByEnvFile.set(envPath, loads);
  const previous = loads.at(-1);
  if (previous !== undefined) {
    putOutOfEffect(previous);
  }
  const recording = recordedLoads.getStore();
  const load: ProjectEnvLoad = {
    fileLoads: loads,
    loaded: new Map(),
    kept: [],
    logged: false,
    withdrawable: recording !== undefined,
  };
  recording?.push(load);
  loads.push(load);
  dropSupersededLoads(loads);
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
  const load = loadsByEnvFile.get(envPath)?.at(-1);
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
  for (const loads of loadsByEnvFile.values()) {
    for (const [name, value] of loads.at(-1)?.loaded ?? []) {
      if (filtered[name] === value) {
        delete filtered[name];
      }
    }
  }
  return filtered;
}
