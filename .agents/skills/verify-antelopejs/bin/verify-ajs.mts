import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { FEATURE_JOURNEYS, SERIAL_FEATURES } from "./journeys/index.mts";
import { parseJourneyResults, runJourney, type JourneyResult } from "./lib/journey.mts";
import { clean, doctor } from "./lib/lifecycle.mts";
import { checkMap, planFor } from "./lib/map.mts";
import { buildBaseCli } from "./lib/base.mts";
import config from "../verify.config.ts";
import { formalGate, runFormalCheck, touchedFormalChecks } from "./lib/formal.mts";
import { doorLine, flaggedDoors, patchFiles } from "./lib/doors.mts";
import { postComment, pushEvidence, readStatus, setStatus } from "./lib/publish.mts";
import { readJudgement, renderVerdict } from "./lib/verdict.mts";
import { defaultJobs } from "./lib/pool.mts";
import { allocateRun, loadRun, REPO_DIR, type RunState, saveRun } from "./lib/run.mts";
import { scheduleFeatures } from "./lib/schedule.mts";
import { seedSources } from "./lib/sources.mts";

const USAGE = `Usage: node .agents/skills/verify-antelopejs/bin/verify-ajs.mts <command>

  map                              check the feature map covers every user-facing file
  plan [--base <ref>] [--all]      map the diff to features; list unmapped surfaces
                                   (a shared file in the diff, or --all before a release, runs every feature)
  new [--no-build] [--base <ref>]  build dist, create an isolated run, print its folder
                                   (--base defaults to origin/main; --no-base skips it)
  doctor <run>                     check the run is worth driving
  journey <run> <feature> [ids...] run a feature's journeys and record evidence
  journeys <run> <feature>... [--jobs <n>]
                                   run the journeys of the features at once, <n> at a time
                                   (default: a quarter of the cores, 2 to 8); results print
                                   per feature
  clean <run>                      stop recorded processes, keep only the evidence
  doors [patch] [--base <ref>]     print the One-way-door line for a patch, or for the diff
  formal <run> [--all]             run the formal checks that cover the diff (or every one) and record them
  verdict <run> --pr <n> [--all]   render evidence/verdict.md from the results and evidence/judgement.json
                                   (--all gates on every feature, as plan --all: pass it for a pre-release verdict)
  publish <run> --pr <n> [--all]   push the evidence to verify-evidence, comment the verdict, set status verify
`;

function print(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function createRun(build: boolean, baseRef: string | undefined): void {
  if (build) {
    execFileSync("pnpm", ["build"], { cwd: REPO_DIR, stdio: "ignore" });
  }
  const state = allocateRun();
  state.manifestUrl = seedSources(state);
  if (baseRef) {
    const base = buildBaseCli(baseRef);
    state.baseRef = baseRef;
    state.baseSha = base.sha;
    state.baseCli = base.cli;
  }
  saveRun(state);
  print(state.dir);
}

function runDoctor(dir: string): number {
  const lines = doctor(loadRun(dir));
  for (const line of lines) {
    print(`${line.ok ? "ok  " : "FAIL"} ${line.check}: ${line.detail}`);
  }
  return lines.every((line) => line.ok) ? 0 : 1;
}

function missingJourneys(feature: string, ids: string[]): string | undefined {
  const journeys = FEATURE_JOURNEYS.get(feature);
  if (!journeys) {
    return `Unknown feature '${feature}'. Known: ${[...FEATURE_JOURNEYS.keys()].join(", ")}`;
  }
  const unknown = ids.filter((id) => !journeys.some((journey) => journey.id === id));
  return unknown.length > 0 ? `Unknown journeys of ${feature}: ${unknown.join(", ")}` : undefined;
}

function journeyLines(result: JourneyResult): string[] {
  const failed = result.steps.flatMap((step) => step.checks.filter((check) => !check.pass).map((check) => `    ${step.name}: ${check.name} (${check.detail})`));
  return [`${result.status} ${result.feature}/${result.journey}`, ...failed, ...(result.error ? [`    ${result.error.split("\n")[0]}`] : [])];
}

/** Writes feature.json: the registered journeys in order, each with the result just obtained or else the earlier one. */
function recordFeature(state: RunState, feature: string, results: JourneyResult[]): void {
  const file = path.join(state.evidence, feature, "feature.json");
  const earlier = existsSync(file) ? parseJourneyResults(readFileSync(file, "utf8")) : [];
  const merged = (FEATURE_JOURNEYS.get(feature) ?? []).flatMap((journey) => results.find((result) => result.journey === journey.id) ?? earlier.filter((result) => result.journey === journey.id));
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
}

async function runOneFeature(dir: string, feature: string, ids: string[]): Promise<number> {
  const problem = missingJourneys(feature, ids);
  if (problem) {
    print(problem);
    return 2;
  }
  const state = loadRun(dir);
  const journeys = FEATURE_JOURNEYS.get(feature) ?? [];
  const results: JourneyResult[] = [];
  for (const journey of ids.length > 0 ? journeys.filter((candidate) => ids.includes(candidate.id)) : journeys) {
    const result = await runJourney(state, feature, journey);
    results.push(result);
    journeyLines(result).forEach(print);
  }
  recordFeature(state, feature, results);
  return results.every((result) => result.status === "PASS") ? 0 : 1;
}

async function runFeatures(dir: string, requested: string[], jobs: number): Promise<number> {
  const features = [...new Set(requested)];
  const problems = features.map((feature) => missingJourneys(feature, [])).filter((problem) => problem !== undefined);
  if (features.length === 0 || problems.length > 0 || !Number.isInteger(jobs) || jobs < 1) {
    print(problems.length > 0 ? problems.join("\n") : "journeys needs at least one feature and a whole --jobs of 1 or more");
    return 2;
  }
  const state = loadRun(dir);
  const runs = features.map((feature) => ({ feature, journeys: FEATURE_JOURNEYS.get(feature) ?? [], serial: SERIAL_FEATURES.get(feature) }));
  let worst = 0;
  for (const outcome of scheduleFeatures(runs, jobs, (feature, journey) => runJourney(state, feature, journey), (feature, results) => recordFeature(state, feature, results))) {
    const { feature, results, error } = await outcome;
    results.flatMap(journeyLines).forEach(print);
    if (error !== undefined) {
      print(`ERROR ${feature}: ${error.split("\n")[0]}`);
    }
    worst = Math.max(worst, error !== undefined || results.some((result) => result.status === "FAIL") ? 1 : 0);
  }
  return worst;
}

function printMap(): number {
  const problems = checkMap();
  for (const problem of problems) {
    print(problem);
  }
  print(problems.length === 0 ? "map ok" : `${problems.length} map problems`);
  return problems.length === 0 ? 0 : 1;
}

function runFormal(dir: string, all: boolean): number {
  const state = loadRun(dir);
  const plan = planFor(state.baseRef || "origin/main", false);
  const touched = touchedFormalChecks(plan.changed);
  const checks = all ? config.formal : touched;
  for (const check of checks) {
    const gate = touched.includes(check);
    const result = runFormalCheck(state, check, gate ? { baseSha: plan.baseSha, headSha: plan.headSha, changed: plan.changed } : null);
    const weight = formalGate(result);
    const outcome = gate ? (weight.fails ? "FAIL" : "PASS") : result.violated.length > 0 ? "VIOLATED" : result.exitCode === 0 ? "HOLDS" : "ERROR";
    print(`${outcome} ${check.name}: ${gate ? weight.outcome : `${result.violated.join(", ") || "no violated rule"} (does not cover the diff)`} (exit ${result.exitCode})`);
  }
  if (checks.length === 0) {
    print("no formal check covers the diff");
  }
  return 0;
}

function printDoors(files: string[]): number {
  const doors = flaggedDoors(files);
  print(doorLine(doors) || "One-way-door: none flagged by path rules");
  for (const door of doors) {
    print(`  ${door.kind}: ${door.files.join(", ")}`);
  }
  return 0;
}

function judge(command: "verdict" | "publish", dir: string, pr: number, all: boolean): number {
  if (!Number.isInteger(pr) || pr <= 0) {
    print(`${command} needs --pr <number>`);
    return 2;
  }
  const state = loadRun(dir);
  const verdict = renderVerdict(state, pr, readJudgement(path.join(state.evidence, "judgement.json")), all);
  print(verdict.markdown);
  if (command === "publish") {
    print(`evidence commit ${pushEvidence(state, verdict)}`);
    const comment = postComment(verdict);
    print(`comment ${comment}`);
    setStatus(verdict, comment);
    print(`status verify on ${verdict.headSha}: ${readStatus(verdict.headSha)}`);
  }
  return verdict.result === "FAIL" ? 1 : 0;
}

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { "no-build": { type: "boolean" }, base: { type: "string", default: "origin/main" }, "no-base": { type: "boolean" }, pr: { type: "string" }, jobs: { type: "string" }, all: { type: "boolean" } } });
  const [command, ...rest] = positionals;
  switch (command) {
    case "new":
      createRun(!values["no-build"], values["no-base"] ? undefined : values.base);
      return 0;
    case "map":
      return printMap();
    case "plan": {
      const plan = planFor(values.base, Boolean(values.all));
      print(JSON.stringify({ ...plan, command: `node ${path.relative(REPO_DIR, process.argv[1])} journeys "$RUN" ${plan.run.join(" ")}` }, null, 2));
      return plan.unmapped.length === 0 ? 0 : 1;
    }
    case "doctor":
      return runDoctor(rest[0]);
    case "journey":
      return runOneFeature(rest[0], rest[1], rest.slice(2));
    case "journeys":
      return runFeatures(rest[0], rest.slice(1), values.jobs === undefined ? defaultJobs() : Number(values.jobs));
    case "clean":
      for (const line of clean(loadRun(rest[0]))) {
        print(line);
      }
      return 0;
    case "doors":
      return printDoors(rest[0] ? patchFiles(rest[0]) : planFor(values.base, false).changed);
    case "formal":
      return runFormal(rest[0], Boolean(values.all));
    case "verdict":
    case "publish":
      return judge(command, rest[0], Number(values.pr), Boolean(values.all));
    default:
      print(USAGE);
      return command ? 2 : 0;
  }
}

process.exitCode = await main(process.argv.slice(2));
