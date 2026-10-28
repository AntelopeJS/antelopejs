import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { REPO_DIR, type RunState } from "./run.mts";
import { originRepository, type Verdict } from "./verdict.mts";

const EVIDENCE_BRANCH = "verify-evidence";
const SCRATCH_BRANCH = "verify-evidence-scratch";

function git(args: string[], cwd = REPO_DIR): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function remoteBranchExists(): boolean {
  return git(["ls-remote", "--heads", "origin", EVIDENCE_BRANCH]) !== "";
}

/**
 * Commits the run's evidence under pr-<n>/<sha>/ of the orphan evidence
 * branch and pushes it. Works in a temporary worktree so the checkout under
 * review is never touched. Returns the pushed evidence commit.
 */
export function pushEvidence(state: RunState, verdict: Verdict): string {
  const worktree = mkdtempSync(path.join(tmpdir(), "verify-evidence-"));
  try {
    if (remoteBranchExists()) {
      git(["fetch", "--quiet", "origin", `${EVIDENCE_BRANCH}:refs/remotes/origin/${EVIDENCE_BRANCH}`]);
      git(["worktree", "add", "--quiet", "--detach", worktree, `origin/${EVIDENCE_BRANCH}`]);
    } else {
      git(["worktree", "add", "--quiet", "--orphan", "-B", SCRATCH_BRANCH, worktree]);
    }
    const target = path.join(worktree, `pr-${verdict.pr}`, verdict.headSha);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    cpSync(state.evidence, target, { recursive: true });
    git(["add", "--all", "."], worktree);
    git(["-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", `verify: evidence for #${verdict.pr} at ${verdict.headSha.slice(0, 7)} (${verdict.result})`], worktree);
    git(["push", "--quiet", "origin", `HEAD:refs/heads/${EVIDENCE_BRANCH}`], worktree);
    return git(["rev-parse", "HEAD"], worktree);
  } finally {
    git(["worktree", "remove", "--force", worktree]);
    if (git(["branch", "--list", SCRATCH_BRANCH]) !== "") {
      git(["branch", "--quiet", "-D", SCRATCH_BRANCH]);
    }
  }
}

/** Posts the verdict as a PR comment and returns the comment URL printed by gh. */
export function postComment(verdict: Verdict): string {
  return execFileSync("gh", ["pr", "comment", String(verdict.pr), "--repo", originRepository(), "--body", verdict.markdown], { cwd: REPO_DIR, encoding: "utf8" }).trim();
}

/** Sets the `verify` commit status on the head SHA the verdict judged. */
export function setStatus(verdict: Verdict, targetUrl: string): void {
  const state = verdict.result === "FAIL" ? "failure" : "success";
  execFileSync(
    "gh",
    [
      "api",
      "--silent",
      `repos/${originRepository()}/statuses/${verdict.headSha}`,
      "-f",
      `state=${state}`,
      "-f",
      "context=verify",
      "-f",
      `description=verify-antelopejs: ${verdict.result}`,
      "-f",
      `target_url=${targetUrl}`,
    ],
    { cwd: REPO_DIR, stdio: "ignore" },
  );
}

/** Reads back the `verify` status GitHub holds for a SHA, so the write is checked through a second command. */
export function readStatus(sha: string): string {
  const statuses: { context: string; state: string }[] = JSON.parse(execFileSync("gh", ["api", `repos/${originRepository()}/commits/${sha}/statuses`], { cwd: REPO_DIR, encoding: "utf8" }));
  return statuses.find((status) => status.context === "verify")?.state ?? "absent";
}
