import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { parseJson, textField } from "./json.mts";
import { killGroup } from "./journey.mts";
import { CLI_ENTRY, isolatedEnv, REPO_DIR, type RunState, saveRun } from "./run.mts";
import { STORE_DIR } from "./sources.mts";

/** One doctor finding. */
export interface DoctorLine {
  check: string;
  ok: boolean;
  detail: string;
}

function newestMtime(folder: string): number {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((newest, entry) => Math.max(newest, statSync(path.join(entry.parentPath, entry.name)).mtimeMs), 0);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cliVersion(state: RunState): string {
  try {
    return execFileSync(process.execPath, [CLI_ENTRY, "--version"], { env: isolatedEnv(state), encoding: "utf8" }).trim();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Answers whether a run is worth driving: the CLI is built from the current
 * sources at the package version, HOME is the run's, the offline manifest is
 * in place, the store is warm, and no process of an earlier run is alive.
 */
export function doctor(state: RunState): DoctorLine[] {
  const packageVersion = textField(parseJson(execFileSync("git", ["show", "HEAD:package.json"], { cwd: REPO_DIR, encoding: "utf8" })), "version");
  const built = existsSync(CLI_ENTRY);
  const distFresh = built && statSync(CLI_ENTRY).mtimeMs >= newestMtime(path.join(REPO_DIR, "src"));
  const version = built ? cliVersion(state) : "missing";
  const env = isolatedEnv(state);
  const leftovers = state.processes.filter((record) => alive(record.pid));
  return [
    { check: "CLI built", ok: built, detail: CLI_ENTRY },
    { check: "dist newer than src", ok: distFresh, detail: distFresh ? "fresh" : "rebuild with pnpm build or verify-ajs new" },
    { check: "CLI version is the package version", ok: version === packageVersion, detail: `ajs --version ${version}, package.json ${packageVersion}` },
    { check: "HOME is the run's", ok: env.HOME === state.home && state.home.startsWith(state.dir), detail: String(env.HOME) },
    { check: "offline manifest seeded", ok: state.manifestUrl.startsWith("file://") && existsSync(new URL(state.manifestUrl)), detail: state.manifestUrl },
    { check: "pnpm store warm", ok: existsSync(STORE_DIR), detail: STORE_DIR },
    { check: "head SHA unchanged since new", ok: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_DIR, encoding: "utf8" }).trim() === state.headSha, detail: state.headSha },
    { check: "no process left from the run", ok: leftovers.length === 0, detail: leftovers.map((record) => `${record.name} pid ${record.pid}`).join(", ") || "none" },
  ];
}

/**
 * Stops what the run started, by recorded PID, then removes everything but
 * the evidence folder and run.json.
 */
export function clean(state: RunState): string[] {
  const removed: string[] = [];
  for (const record of state.processes) {
    if (alive(record.pid)) {
      killGroup(record.pid);
      removed.push(`killed ${record.name} pid ${record.pid}`);
    }
  }
  state.processes = [];
  saveRun(state);
  for (const entry of readdirSync(state.dir)) {
    if (entry === "evidence" || entry === "run.json") {
      continue;
    }
    rmSync(path.join(state.dir, entry), { recursive: true, force: true });
    removed.push(`removed ${entry}/`);
  }
  return removed;
}
