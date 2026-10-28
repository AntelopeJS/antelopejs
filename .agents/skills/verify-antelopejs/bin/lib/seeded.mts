import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { REPO_DIR, SKILL_DIR } from "./run.mts";

/** The outcome of running one feature's journeys against its seeded break. */
export interface SeededResult {
  feature: string;
  caught: boolean;
  run: string;
  output: string;
}

function inWorktree(worktree: string, program: string, args: string[]): string {
  return execFileSync(program, args, { cwd: worktree, encoding: "utf8", env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Applies seeded-breaks/<feature>.patch to a scratch worktree of HEAD, builds
 * it, and runs the feature's journeys there with this checkout's skill. The
 * break is caught when the journeys fail. The worktree is removed; the run's
 * evidence stays.
 */
export function runSeededBreak(feature: string, baseRef: string): SeededResult {
  const worktree = mkdtempSync(path.join(tmpdir(), `verify-antelopejs-seeded-${feature}-`));
  try {
    execFileSync("git", ["worktree", "add", "--detach", "--force", worktree, "HEAD"], { cwd: REPO_DIR, stdio: "ignore" });
    const skill = path.join(worktree, path.relative(REPO_DIR, SKILL_DIR));
    rmSync(skill, { recursive: true, force: true });
    cpSync(SKILL_DIR, skill, { recursive: true });
    inWorktree(worktree, "git", ["apply", path.join(skill, "seeded-breaks", `${feature}.patch`)]);
    inWorktree(worktree, "pnpm", ["install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"]);
    inWorktree(worktree, "pnpm", ["build"]);
    const cli = path.join(skill, "bin", "verify-ajs.mts");
    const run = inWorktree(worktree, process.execPath, [cli, "new", "--no-build", "--base", baseRef]);
    const journeys = spawnSync(process.execPath, [cli, "journey", run, feature], { cwd: worktree, encoding: "utf8" });
    return { feature, caught: journeys.status !== 0, run, output: `${journeys.stdout}${journeys.stderr}` };
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: REPO_DIR, stdio: "ignore" });
  }
}
