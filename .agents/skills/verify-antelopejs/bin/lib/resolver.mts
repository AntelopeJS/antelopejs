import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

import { CACHE_DIR } from "./run.mts";

/** The repository whose plugin holds the interface resolver behind `/antelopejs:interface`. */
export const AGENT_SKILLS_REPOSITORY = "https://github.com/AntelopeJS/agent-skills.git";

/** The ref of agent-skills the journeys read the resolver from, `main` unless `AJS_VERIFY_AGENT_SKILLS_REF` names another. */
export function agentSkillsRef(): string {
  return process.env.AJS_VERIFY_AGENT_SKILLS_REF || "main";
}

/** The resolver script of one agent-skills checkout, and the commit it is at. */
export interface Resolver {
  script: string;
  ref: string;
  sha: string;
}

const MIRROR_DIR = path.join(CACHE_DIR, "agent-skills.git");

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function ensureMirror(): void {
  if (existsSync(MIRROR_DIR)) {
    return;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  const partial = `${MIRROR_DIR}.partial-${process.pid}`;
  rmSync(partial, { recursive: true, force: true });
  git(["clone", "--quiet", "--bare", AGENT_SKILLS_REPOSITORY, partial]);
  renameSync(partial, MIRROR_DIR);
}

/**
 * The interface resolver of the agent-skills `ref`, from a worktree per
 * commit under the skill cache. Fetching the ref needs the network, once
 * per call; the lookups the journeys then make run offline.
 */
export function ensureResolver(ref = agentSkillsRef()): Resolver {
  ensureMirror();
  git(["fetch", "--quiet", "origin", ref], MIRROR_DIR);
  const sha = git(["rev-parse", "FETCH_HEAD"], MIRROR_DIR);
  const checkout = path.join(CACHE_DIR, "agent-skills", sha);
  if (!existsSync(checkout)) {
    mkdirSync(path.dirname(checkout), { recursive: true });
    git(["worktree", "add", "--quiet", "--detach", checkout, sha], MIRROR_DIR);
  }
  return { script: path.join(checkout, "plugin", "scripts", "resolve-interface.mjs"), ref, sha };
}
