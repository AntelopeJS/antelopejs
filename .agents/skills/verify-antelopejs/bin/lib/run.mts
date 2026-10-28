import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

/** The skill folder, `.agents/skills/verify-antelopejs`. */
export const SKILL_DIR = path.resolve(import.meta.dirname, "..", "..");

/** The antelopejs checkout the skill belongs to. */
export const REPO_DIR = path.resolve(SKILL_DIR, "..", "..", "..");

/** The built CLI every journey drives. */
export const CLI_ENTRY = path.join(REPO_DIR, "dist", "core", "cli", "index.js");

/** The built library entry, `@antelopejs/core` as a consumer imports it. */
export const CORE_ENTRY = path.join(REPO_DIR, "dist", "index.js");

/**
 * Caches shared by every run: the warm pnpm store, the npm cache and the
 * built base CLIs. Nothing a journey asserts on lives here.
 */
export const CACHE_DIR = path.join(
  process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"),
  "verify-antelopejs",
);

const REAL_COREPACK_HOME =
  process.env.COREPACK_HOME ?? path.join(homedir(), ".cache", "node", "corepack");

/** A process a run started in the background, found again by its PID. */
export interface ProcessRecord {
  name: string;
  pid: number;
  port: number;
  cwd: string;
  startedAt: string;
}

/** The persisted state of one isolated run. */
export interface RunState {
  id: string;
  dir: string;
  home: string;
  work: string;
  evidence: string;
  manifestUrl: string;
  createdAt: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  baseCli: string;
  processes: ProcessRecord[];
}

/** The folders of a run, derived from its root. */
export function runPaths(dir: string): Pick<RunState, "dir" | "home" | "work" | "evidence"> {
  return {
    dir,
    home: path.join(dir, "home"),
    work: path.join(dir, "work"),
    evidence: path.join(dir, "evidence"),
  };
}

function stateFile(dir: string): string {
  return path.join(dir, "run.json");
}

/** Reads a run created by `verify-ajs new`, failing with the reason when it is missing. */
export function loadRun(dir: string): RunState {
  const file = stateFile(path.resolve(dir));
  if (!existsSync(file)) {
    throw new Error(`No run at ${dir}: run.json is missing. Create one with verify-ajs new.`);
  }
  const state: RunState = JSON.parse(readFileSync(file, "utf8"));
  return state;
}

/** Persists the run state. */
export function saveRun(state: RunState): void {
  writeFileSync(stateFile(state.dir), `${JSON.stringify(state, null, 2)}\n`);
}

/** The commit the checkout is at, which every verdict names. */
export function headSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_DIR, encoding: "utf8" }).trim();
}

/** Allocates the folders of a new run under the system temp folder. */
export function allocateRun(): RunState {
  const id = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomBytes(3).toString("hex")}`;
  const dir = path.join(tmpdir(), "verify-antelopejs", id);
  const paths = runPaths(dir);
  for (const folder of [paths.home, paths.work, paths.evidence]) {
    mkdirSync(folder, { recursive: true });
  }
  return {
    ...paths,
    id,
    manifestUrl: "",
    createdAt: new Date().toISOString(),
    headSha: headSha(),
    baseRef: "",
    baseSha: "",
    baseCli: "",
    processes: [],
  };
}

const INHERITED_PREFIXES = ["ANTELOPEJS_", "npm_", "PNPM_", "XDG_"];

/**
 * The environment every driven command gets: the run's HOME, CI=1, no update
 * check, no colors, and the shared caches. Variables that could leak the
 * operator's own settings into the run are dropped.
 */
export function isolatedEnv(state: RunState, extra: Record<string, string> = {}, home = state.home): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(
    ([key]) => !INHERITED_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
  return {
    ...Object.fromEntries(kept),
    HOME: home,
    USERPROFILE: home,
    CI: "1",
    AJS_NO_UPDATE_CHECK: "1",
    NO_COLOR: "1",
    TERM: "xterm-256color",
    COREPACK_HOME: REAL_COREPACK_HOME,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    XDG_DATA_HOME: path.join(CACHE_DIR, "xdg-data"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    npm_config_cache: path.join(CACHE_DIR, "npm"),
    npm_config_offline: "true",
    GIT_CONFIG_NOSYSTEM: "1",
    ...extra,
  };
}
