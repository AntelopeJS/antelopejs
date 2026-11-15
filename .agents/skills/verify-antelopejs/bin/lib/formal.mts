import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import config, { type FormalCheck } from "../../verify.config.ts";
import { REPO_DIR, type RunState } from "./run.mts";

/** The recorded outcome of one formal check in a run. */
export interface FormalResult {
  name: string;
  exitCode: number | null;
  violated: string[];
  folder: string;
}

/** The formal checks whose covered files or own `files` a set of changed files touches. */
export function touchedFormalChecks(changed: string[], checks: FormalCheck[] = config.formal): FormalCheck[] {
  return checks.filter((check) => changed.some((file) => check.covers.includes(file) || check.files.some((glob) => path.matchesGlob(file, glob))));
}

function violatedRules(check: FormalCheck, exitCode: number | null, output: string): string[] {
  if (check.violation) {
    return [...new Set([...output.matchAll(check.violation)].map((match) => match[1]))];
  }
  return exitCode === 0 ? [] : ["property"];
}

/**
 * Runs one formal check from the repository root and writes its command,
 * output, exit code and violated rules under evidence/formal/<name>/.
 */
export function runFormalCheck(state: RunState, check: FormalCheck): FormalResult {
  const folder = path.join(state.evidence, "formal", check.name);
  mkdirSync(folder, { recursive: true });
  const [program, ...args] = check.command;
  const run = spawnSync(program, args, { cwd: REPO_DIR, encoding: "utf8", env: { ...process.env, TERM: "xterm-256color" }, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(path.join(folder, "command.txt"), `${check.command.join(" ")}\n`);
  writeFileSync(path.join(folder, "stdout.txt"), run.stdout ?? "");
  writeFileSync(path.join(folder, "stderr.txt"), `${run.stderr ?? ""}${run.error ? `\n${run.error.message}\n` : ""}`);
  writeFileSync(path.join(folder, "exit-code.txt"), `${run.status}\n`);
  const result: FormalResult = { name: check.name, exitCode: run.status, violated: violatedRules(check, run.status, run.stdout ?? ""), folder: path.relative(state.evidence, folder) };
  writeFileSync(path.join(folder, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
