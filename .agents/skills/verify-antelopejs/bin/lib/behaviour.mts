import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

import type { FormalCheck } from "../../verify.config.ts";
import { REPO_DIR } from "./run.mts";

const CODE_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"]);
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

function fileAt(sha: string, file: string): string | null {
  const shown = spawnSync("git", ["show", `${sha}:${file}`], { cwd: REPO_DIR, encoding: "utf8", maxBuffer: OUTPUT_LIMIT });
  return shown.status === 0 ? shown.stdout : null;
}

function scriptStatements(file: string, source: string): string[] {
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true, experimentalDecorators: true },
  });
  const emitted = ts.createSourceFile("emit.js", outputText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const printer = ts.createPrinter({ removeComments: true });
  return emitted.statements
    .filter((statement) => !ts.isImportDeclaration(statement))
    .filter((statement) => !(ts.isExportDeclaration(statement) && statement.moduleSpecifier))
    .map((statement) => printer.printNode(ts.EmitHint.Unspecified, statement, emitted).replace(/^export (default )?/, ""));
}

function statementsOf(file: string, source: string): string[] {
  if (CODE_EXTENSIONS.has(path.extname(file))) {
    return scriptStatements(file, source);
  }
  return [`file ${source.replace(/\s+/g, " ").trim()}`];
}

/**
 * What the covered code does at a commit, as the sorted top-level
 * statements of its JavaScript: types, comments, formatting, imports and
 * export keywords left out, so a type-only edit, a comment or a verbatim
 * move between covered files keeps the same fingerprint.
 */
export function emitFingerprint(sha: string, files: string[]): string[] {
  return files
    .flatMap((file) => {
      const source = fileAt(sha, file);
      return source === null ? [] : statementsOf(file, source);
    })
    .sort((left, right) => left.localeCompare(right));
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

function difference(left: string[], right: string[]): string[] {
  const counts = new Map<string, number>();
  for (const item of right) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return left.filter((item) => {
    const count = counts.get(item) ?? 0;
    if (count === 0) {
      return true;
    }
    counts.set(item, count - 1);
    return false;
  });
}

function summary(lines: string[]): string[] {
  return lines.slice(0, DETAIL_LIMIT).map((line) => (line.length > DETAIL_LENGTH ? `${line.slice(0, DETAIL_LENGTH)}…` : line));
}

/**
 * Whether a diff changed the behaviour of the code a formal check covers,
 * decided without judgement: for `emit`, the covered files keep the same
 * JavaScript statements on the base and on HEAD; for `probe`, the check's
 * probe prints the same lines on a checkout of each.
 */
export function behaviourChange(check: FormalCheck, commits: Commits): BehaviourChange {
  const behaviour = check.behaviour;
  const fingerprint = (sha: string) => (behaviour.kind === "probe" ? probeFingerprint(behaviour.command, sha) : emitFingerprint(sha, check.covers));
  const base = fingerprint(commits.baseSha);
  const head = fingerprint(commits.headSha);
  const removed = difference(base, head);
  const added = difference(head, base);
  return {
    method: behaviour.kind === "probe" ? `probe ${behaviour.command.join(" ")}` : "emit",
    changed: removed.length + added.length > 0,
    removed: summary(removed),
    added: summary(added),
  };
}
