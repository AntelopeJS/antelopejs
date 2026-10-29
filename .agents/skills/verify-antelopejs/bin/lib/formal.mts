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
  folder: string;
  commits?: Commits;
  behaviour?: BehaviourChange;
  base?: { exitCode: number | null; violated: string[] } | null;
  fixed?: string[];
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

function gateFields(check: FormalCheck, commits: Commits, folder: string, violated: string[]): Pick<FormalResult, "behaviour" | "base" | "fixed"> {
  const behaviour = behaviourChange(check, commits);
  if (!behaviour.changed) {
    return { behaviour, base: null, fixed: [] };
  }
  const run = inWorktree(commits.baseSha, (dir) => runCommand(check.command, dir));
  writeRun(folder, "base-", check.command, run);
  const base = { exitCode: run.status, violated: violatedRules(check, run.status, run.stdout ?? "") };
  return { behaviour, base, fixed: base.violated.filter((rule) => !violated.includes(rule)) };
}

/**
 * Runs one formal check from the repository root and writes its command,
 * output, exit code and violated rules under evidence/formal/<name>/. When
 * the diff touches the check (`commits` given), it also records whether the
 * diff changed the covered behaviour and, when it did, runs the check on the
 * base to tell which rules HEAD fixed.
 */
export function runFormalCheck(state: RunState, check: FormalCheck, commits: Commits | null): FormalResult {
  const folder = path.join(state.evidence, "formal", check.name);
  mkdirSync(folder, { recursive: true });
  const run = runCommand(check.command, REPO_DIR);
  writeRun(folder, "", check.command, run);
  const violated = violatedRules(check, run.status, run.stdout ?? "");
  const result: FormalResult = { name: check.name, exitCode: run.status, violated, folder: path.relative(state.evidence, folder) };
  if (commits) {
    Object.assign(result, { commits }, gateFields(check, commits, folder, violated));
  }
  writeFileSync(path.join(folder, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/**
 * How a formal result weighs on a verdict whose diff the check covers: a
 * non-zero exit (a tool error, or a check that no longer matches its record)
 * fails; recorded findings fail only when the diff changed the covered
 * behaviour; rules the base broke and HEAD no longer does are reported as
 * fixed.
 */
export function formalGate(result: FormalResult): FormalWeight {
  if (result.exitCode !== 0) {
    const what = result.violated.length > 0 ? `the check no longer matches its record: ${result.violated.join(", ")}` : "tool error";
    return { fails: true, outcome: `${what}, exit ${result.exitCode}` };
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
