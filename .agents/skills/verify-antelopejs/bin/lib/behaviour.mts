import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FormalCheck } from "../../verify.config.ts";
import { type EmitFingerprint, type EmitItem, emitFingerprint } from "./emit.mts";
import { REPO_DIR } from "./run.mts";

const DETAIL_LIMIT = 5;
const DETAIL_LENGTH = 160;
const OUTPUT_LIMIT = 64 * 1024 * 1024;

/** Whether a diff changed what the code a formal check covers does, and what differs. */
export interface BehaviourChange {
  method: string;
  changed: boolean;
  removed: string[];
  added: string[];
}

/** The two commits a diff runs between. */
export interface Commits {
  baseSha: string;
  headSha: string;
}

/** Runs `action` in a throwaway worktree of `sha` whose `node_modules` links the checkout's, then removes it. */
export function inWorktree<T>(sha: string, action: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-antelopejs-behaviour-"));
  execFileSync("git", ["worktree", "add", "--quiet", "--detach", "--force", dir, sha], { cwd: REPO_DIR, stdio: "ignore" });
  symlinkSync(path.join(REPO_DIR, "node_modules"), path.join(dir, "node_modules"));
  try {
    return action(dir);
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: REPO_DIR, stdio: "ignore" });
    rmSync(dir, { recursive: true, force: true });
  }
}

function probeFingerprint(command: string[], sha: string): string[] {
  const [program, ...args] = command;
  return inWorktree(sha, (dir) => {
    const run = spawnSync(program, [...args, dir], { cwd: REPO_DIR, encoding: "utf8", maxBuffer: OUTPUT_LIMIT });
    if (run.status !== 0) {
      throw new Error(`behaviour probe ${command.join(" ")} failed on ${sha}:\n${run.stderr}`);
    }
    return run.stdout.split("\n").filter(Boolean);
  });
}

function difference<Item>(left: Item[], right: Item[], key: (item: Item) => string): Item[] {
  const counts = new Map<string, number>();
  for (const item of right) {
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  }
  return left.filter((item) => {
    const count = counts.get(key(item)) ?? 0;
    if (count === 0) {
      return true;
    }
    counts.set(key(item), count - 1);
    return false;
  });
}

function summary(lines: string[]): string[] {
  return lines.slice(0, DETAIL_LIMIT).map((line) => (line.length > DETAIL_LENGTH ? `${line.slice(0, DETAIL_LENGTH)}…` : line));
}

interface Differences {
  removed: string[];
  added: string[];
}

function sequenceChanges(file: string, base: EmitItem[], head: EmitItem[]): Differences {
  const length = Math.max(base.length, head.length);
  for (let index = 0; index < length; index += 1) {
    if (base[index]?.structure !== head[index]?.structure) {
      return {
        removed: [`${file} statement ${index + 1}: ${base[index]?.text ?? "(none)"}`],
        added: [`${file} statement ${index + 1}: ${head[index]?.text ?? "(none)"}`],
      };
    }
  }
  return { removed: [], added: [] };
}

function compareEmit(base: EmitFingerprint, head: EmitFingerprint): Differences {
  const structure = (item: EmitItem) => item.structure;
  const removed = difference(base.functions, head.functions, structure).map((item) => `hoisted ${item.text}`);
  const added = difference(head.functions, base.functions, structure).map((item) => `hoisted ${item.text}`);
  for (const file of new Set([...Object.keys(base.files), ...Object.keys(head.files)])) {
    const change = sequenceChanges(file, base.files[file] ?? [], head.files[file] ?? []);
    removed.push(...change.removed);
    added.push(...change.added);
  }
  return { removed, added };
}

function compareProbe(base: string[], head: string[]): Differences {
  if (JSON.stringify(base) === JSON.stringify(head)) {
    return { removed: [], added: [] };
  }
  const line = (item: string) => item;
  const removed = difference(base, head, line);
  const added = difference(head, base, line);
  return removed.length + added.length > 0 ? { removed, added } : { removed: ["(order)"], added: ["(order)"] };
}

/**
 * Whether a diff changed the behaviour of the code a formal check covers,
 * decided without judgement. For `emit`, each covered file keeps its
 * top-level statements, in order, with the same structure, and the covered
 * function declarations stay the same wherever they live; for `probe`, the
 * check's probe prints the same lines on a checkout of each. `repo` is the
 * checkout the commits belong to.
 */
export function behaviourChange(check: FormalCheck, commits: Commits, repo: string = REPO_DIR): BehaviourChange {
  const behaviour = check.behaviour;
  const change =
    behaviour.kind === "probe"
      ? compareProbe(probeFingerprint(behaviour.command, commits.baseSha), probeFingerprint(behaviour.command, commits.headSha))
      : compareEmit(emitFingerprint(repo, commits.baseSha, check.covers), emitFingerprint(repo, commits.headSha, check.covers));
  return {
    method: behaviour.kind === "probe" ? `probe ${behaviour.command.join(" ")}` : "emit",
    changed: change.removed.length + change.added.length > 0,
    removed: summary(change.removed),
    added: summary(change.added),
  };
}
