import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { JourneyResult } from "./journey.mts";
import { REPO_DIR, SKILL_DIR } from "./run.mts";

/** The outcome of one feature's seeded break, judged against an unpatched control run. */
export interface SeededResult {
  feature: string;
  caught: boolean;
  run: string;
  controlRun: string;
  caughtBy: string[];
  failingInControl: string[];
  harnessErrors: string[];
  output: string;
}

interface FeatureRun {
  run: string;
  results: JourneyResult[];
  output: string;
}

function inWorktree(worktree: string, program: string, args: string[]): string {
  return execFileSync(program, args, { cwd: worktree, encoding: "utf8", env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function prepareWorktree(label: string, patch: string | null): string {
  const worktree = mkdtempSync(path.join(tmpdir(), `verify-antelopejs-seeded-${label}-`));
  execFileSync("git", ["worktree", "add", "--detach", "--force", worktree, "HEAD"], { cwd: REPO_DIR, stdio: "ignore" });
  const skill = path.join(worktree, path.relative(REPO_DIR, SKILL_DIR));
  rmSync(skill, { recursive: true, force: true });
  cpSync(SKILL_DIR, skill, { recursive: true });
  if (patch) {
    inWorktree(worktree, "git", ["apply", path.join(skill, "seeded-breaks", `${patch}.patch`)]);
  }
  inWorktree(worktree, "pnpm", ["install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"]);
  inWorktree(worktree, "pnpm", ["build"]);
  return worktree;
}

function removeWorktree(worktree: string): void {
  execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: REPO_DIR, stdio: "ignore" });
}

function runFeatureIn(worktree: string, feature: string, baseRef: string): FeatureRun {
  const cli = path.join(worktree, path.relative(REPO_DIR, SKILL_DIR), "bin", "verify-ajs.mts");
  const run = inWorktree(worktree, process.execPath, [cli, "new", "--no-build", "--base", baseRef]);
  const journeys = spawnSync(process.execPath, [cli, "journey", run, feature], { cwd: worktree, encoding: "utf8" });
  const file = path.join(run, "evidence", feature, "feature.json");
  const results: JourneyResult[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  return { run, results, output: `${journeys.stdout}${journeys.stderr}` };
}

function failsACheck(result: JourneyResult): boolean {
  return result.steps.some((step) => step.checks.some((check) => !check.pass));
}

function judge(feature: string, control: FeatureRun, seeded: FeatureRun): SeededResult {
  const passedInControl = new Set(control.results.filter((result) => result.status === "PASS").map((result) => result.journey));
  const failed = seeded.results.filter((result) => result.status === "FAIL");
  const caughtBy = failed.filter((result) => passedInControl.has(result.journey) && failsACheck(result)).map((result) => result.journey);
  return {
    feature,
    caught: caughtBy.length > 0,
    run: seeded.run,
    controlRun: control.run,
    caughtBy,
    failingInControl: control.results.filter((result) => result.status === "FAIL").map((result) => result.journey),
    harnessErrors: failed.filter((result) => !failsACheck(result)).map((result) => result.journey),
    output: seeded.output,
  };
}

/**
 * Runs each feature's journeys twice from scratch worktrees of HEAD: once
 * unpatched as the control, once with seeded-breaks/<feature>.patch applied.
 * A break is caught only when a journey that passes in the control fails one
 * of its checks with the patch. A failure without a failing check is a harness
 * error and does not count. Worktrees are removed; both runs' evidence stays.
 */
export function runSeededBreaks(features: string[], baseRef: string): SeededResult[] {
  const controlTree = prepareWorktree("control", null);
  try {
    return features.map((feature) => {
      const control = runFeatureIn(controlTree, feature, baseRef);
      const seededTree = prepareWorktree(feature, feature);
      try {
        return judge(feature, control, runFeatureIn(seededTree, feature, baseRef));
      } finally {
        removeWorktree(seededTree);
      }
    });
  } finally {
    removeWorktree(controlTree);
  }
}
