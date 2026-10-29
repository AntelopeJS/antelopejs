import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import config, { type FormalCheck } from "../../verify.config.ts";
import { type BehaviourChange, behaviourChange, type Commits, inWorktree } from "./behaviour.mts";
import { REPO_DIR, type RunState } from "./run.mts";

/**
 * The recorded outcome of one formal check in a run. A check that covers the
 * diff also records whether the diff changed the covered behaviour and, when
 * it did, the base run and the rules HEAD fixed.
 */
export interface FormalResult {
  name: string;
  exitCode: number | null;
  violated: string[];
  passing?: string[];
  folder: string;
  commits?: Commits;
  behaviour?: BehaviourChange;
  checkChanged?: boolean;
  base?: Rules | null;
  fixed?: string[];
  missing?: string[];
}

/** The rules a run of the check reported as broken and as holding. */
interface Rules {
  exitCode: number | null;
  violated: string[];
  passing: string[];
}

/** The diff a covered check is gated on: its two commits and the files it changed. */
export interface FormalDiff extends Commits {
  changed: string[];
}

/** How a formal result weighs on a verdict whose diff the check covers. */
export interface FormalWeight {
  fails: boolean;
  outcome: string;
}

/** The formal checks whose covered files a set of changed files touches. */
export function touchedFormalChecks(changed: string[]): FormalCheck[] {
  return config.formal.filter((check) => changed.some((file) => check.covers.includes(file)));
}

function violatedRules(check: FormalCheck, exitCode: number | null, output: string): string[] {
  if (check.violation) {
    return [...new Set([...output.matchAll(check.violation)].map((match) => match[1]))];
  }
  return exitCode === 0 ? [] : ["property"];
}

function passingRules(check: FormalCheck, exitCode: number | null, output: string): string[] {
  if (check.passing) {
    return [...new Set([...output.matchAll(check.passing)].map((match) => match[1]))];
  }
  return !check.violation && exitCode === 0 ? ["property"] : [];
}

function rulesOf(check: FormalCheck, run: ReturnType<typeof runCommand>): Rules {
  const output = run.stdout ?? "";
  return { exitCode: run.status, violated: violatedRules(check, run.status, output), passing: passingRules(check, run.status, output) };
}

function runCommand(command: string[], cwd: string) {
  const [program, ...args] = command;
  return spawnSync(program, args, { cwd, encoding: "utf8", env: { ...process.env, TERM: "xterm-256color" }, maxBuffer: 64 * 1024 * 1024 });
}

function writeRun(folder: string, prefix: string, command: string[], run: ReturnType<typeof runCommand>): void {
  writeFileSync(path.join(folder, `${prefix}command.txt`), `${command.join(" ")}\n`);
  writeFileSync(path.join(folder, `${prefix}stdout.txt`), run.stdout ?? "");
  writeFileSync(path.join(folder, `${prefix}stderr.txt`), `${run.stderr ?? ""}${run.error ? `\n${run.error.message}\n` : ""}`);
  writeFileSync(path.join(folder, `${prefix}exit-code.txt`), `${run.status}\n`);
}

function gateFields(check: FormalCheck, diff: FormalDiff, folder: string, head: Rules): Partial<FormalResult> {
  const behaviour = behaviourChange(check, diff);
  const checkChanged = diff.changed.some((file) => check.files.some((glob) => path.matchesGlob(file, glob)));
  if (!behaviour.changed && !checkChanged) {
    return { behaviour, checkChanged, base: null, fixed: [], missing: [] };
  }
  const run = inWorktree(diff.baseSha, (dir) => runCommand(check.command, dir));
  writeRun(folder, "base-", check.command, run);
  const base = rulesOf(check, run);
  const atHead = new Set([...head.violated, ...head.passing]);
  return {
    behaviour,
    checkChanged,
    base,
    fixed: base.violated.filter((rule) => head.passing.includes(rule) && !head.violated.includes(rule)),
    missing: base.violated.filter((rule) => !atHead.has(rule)),
  };
}

/**
 * Runs one formal check from the repository root and writes its command,
 * output, exit code and violated rules under evidence/formal/<name>/. When
 * the diff touches the check (`diff` given), it also records whether the
 * diff changed the covered behaviour. When it did, or when the diff changed
 * the check's own `files`, it runs the check on the base: `fixed` lists the
 * rules the base broke that HEAD reports passing, and `missing` the rules the
 * base broke that HEAD reports neither failing nor passing.
 */
export function runFormalCheck(state: RunState, check: FormalCheck, diff: FormalDiff | null): FormalResult {
  const folder = path.join(state.evidence, "formal", check.name);
  mkdirSync(folder, { recursive: true });
  const run = runCommand(check.command, REPO_DIR);
  writeRun(folder, "", check.command, run);
  const head = rulesOf(check, run);
  const result: FormalResult = { name: check.name, exitCode: run.status, violated: head.violated, passing: head.passing, folder: path.relative(state.evidence, folder) };
  if (diff) {
    Object.assign(result, { commits: { baseSha: diff.baseSha, headSha: diff.headSha } }, gateFields(check, diff, folder, head));
  }
  writeFileSync(path.join(folder, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/**
 * How a formal result weighs on a verdict whose diff the check covers: a
 * non-zero exit (a tool error, or a check that no longer matches its record)
 * fails; recorded findings fail only when the diff changed the covered
 * behaviour; a rule the base broke that HEAD does not report at all fails;
 * rules the base broke that HEAD reports passing are reported as fixed.
 */
export function formalGate(result: FormalResult): FormalWeight {
  if (result.exitCode !== 0) {
    const what = result.violated.length > 0 ? `the check no longer matches its record: ${result.violated.join(", ")}` : "tool error";
    return { fails: true, outcome: `${what}, exit ${result.exitCode}` };
  }
  if (result.missing && result.missing.length > 0) {
    return { fails: true, outcome: `rules the base broke are absent at HEAD: ${result.missing.join(", ")}` };
  }
  if (!result.behaviour) {
    return { fails: result.violated.length > 0, outcome: `violated ${result.violated.join(", ") || "nothing"}` };
  }
  const fixed = result.fixed && result.fixed.length > 0 ? `; fixed: ${result.fixed.join(", ")}` : "";
  if (!result.behaviour.changed) {
    const known = result.violated.length > 0 ? `known findings ${result.violated.join(", ")}` : "no violated rule";
    return { fails: false, outcome: `covered behaviour unchanged (${result.behaviour.method}): ${known}` };
  }
  if (result.violated.length === 0) {
    return { fails: false, outcome: `covered behaviour changed (${result.behaviour.method}), no violated rule${fixed}` };
  }
  return { fails: true, outcome: `covered behaviour changed (${result.behaviour.method}), violated ${result.violated.join(", ")}${fixed}` };
}

/** The recorded result of a formal check in a run, if it ran. */
export function readFormalResult(state: RunState, name: string): FormalResult | undefined {
  const file = path.join(state.evidence, "formal", name, "result.json");
  if (!existsSync(file)) {
    return undefined;
  }
  const result: FormalResult = JSON.parse(readFileSync(file, "utf8"));
  return result;
}
