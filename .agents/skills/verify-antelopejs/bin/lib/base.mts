import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { CACHE_DIR, REPO_DIR } from "./run.mts";

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_DIR, encoding: "utf8" }).trim();
}

/**
 * Builds the CLI of `ref` in a cached worktree, once per commit, so Format
 * containment journeys can write state with the base and read it with the
 * head. Returns the commit and the built CLI entry.
 */
export function buildBaseCli(ref: string) {
  const sha = git(["rev-parse", `${ref}^{commit}`]);
  const folder = path.join(CACHE_DIR, "base", sha);
  const cli = path.join(folder, "dist", "core", "cli", "index.js");
  if (existsSync(cli)) {
    return { sha, cli };
  }
  rmSync(folder, { recursive: true, force: true });
  git(["worktree", "prune"]);
  git(["worktree", "add", "--detach", folder, sha]);
  const env = { ...process.env, CI: "1" };
  execFileSync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], { cwd: folder, env, stdio: "ignore" });
  execFileSync("pnpm", ["build"], { cwd: folder, env, stdio: "ignore" });
  return { sha, cli };
}
