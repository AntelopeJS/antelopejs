import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FEATURE_JOURNEYS } from "../../journeys/index.mts";
import { field, type JsonRead, parseJson } from "../json.mts";
import { REPO_DIR, SKILL_DIR } from "../run.mts";

/** What the `verdict` command printed and recorded for a crafted run. */
export interface DrivenVerdict {
  status: number | null;
  stdout: string;
  stderr: string;
  full: JsonRead;
}

/** The `known:` journey ids of each fixture feature file, keyed by feature name. */
export type KnownFixture = Record<string, string[]>;

const JUDGEMENT = { doors: { none: "test", rows: [] }, docs: [], notVerified: [], attention: [], verifier: "verdict test" };

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeRun(dir: string, repo: string, failing: Set<string>, baseRef: string): void {
  const evidence = path.join(dir, "evidence");
  mkdirSync(evidence, { recursive: true });
  const state = { id: "x", dir, home: path.join(dir, "home"), work: path.join(dir, "work"), evidence, manifestUrl: "file:///x", createdAt: new Date().toISOString(), headSha: git(repo, ["rev-parse", "HEAD"]), baseRef, baseSha: "", baseCli: "", processes: [] };
  writeFileSync(path.join(dir, "run.json"), JSON.stringify(state));
  for (const [feature, journeys] of FEATURE_JOURNEYS) {
    mkdirSync(path.join(evidence, feature), { recursive: true });
    const results = journeys.map((journey) => ({ feature, journey: journey.id, title: journey.title, entryPoint: journey.entryPoint, status: failing.has(`${feature}/${journey.id}`) ? "FAIL" : "PASS", steps: [], error: null, folder: `${feature}/${journey.id}` }));
    writeFileSync(path.join(evidence, feature, "feature.json"), JSON.stringify(results));
  }
  writeFileSync(path.join(evidence, "judgement.json"), JSON.stringify(JUDGEMENT));
}

function commit(root: string, message: string): void {
  git(root, ["add", "--all"]);
  git(root, ["-c", "user.name=verdict test", "-c", "user.email=verdict@test", "-c", "commit.gpgsign=false", "commit", "--quiet", "--message", message]);
}

function fixtureRepo(root: string, known: KnownFixture, touched: string[]) {
  const skill = path.join(root, path.relative(REPO_DIR, SKILL_DIR));
  const features = path.join(SKILL_DIR, "features");
  cpSync(SKILL_DIR, skill, { recursive: true, filter: (source) => source !== features });
  mkdirSync(path.join(skill, "features"));
  for (const [feature, ids] of Object.entries(known)) {
    writeFileSync(path.join(skill, "features", `${feature}.md`), ["---", "covers:", `  - fixture/${feature}/**`, "known:", ...ids.map((id) => `  - ${id}`), "---", ""].join("\n"));
  }
  git(root, ["init", "--quiet"]);
  commit(root, "fixture");
  const baseRef = git(root, ["rev-parse", "HEAD"]);
  for (const feature of touched) {
    mkdirSync(path.join(root, "fixture", feature), { recursive: true });
    writeFileSync(path.join(root, "fixture", feature, "touched.ts"), "");
  }
  if (touched.length > 0) {
    commit(root, "touch");
  }
  symlinkSync(path.join(REPO_DIR, "node_modules"), path.join(root, "node_modules"), "junction");
  return { skill, baseRef };
}

/**
 * Crafts a run with the named
 * `<feature>/<journey>` results failing and every other journey passing, and
 * drives `verify-ajs verdict` on it with `args`. With `known`, the verdict
 * runs in a scratch repository whose committed feature files are those
 * fixtures, so the base lists their `known:` ids, and each fixture covers
 * `fixture/<feature>/**`; a feature named in `touched` gets a file there
 * committed on top of the base, so the diff touches it. Without `known`, in this
 * repository against the real feature files. Throws with the verdict's
 * stderr when it wrote no plan.
 */
export function driveVerdict(failing: string[], args: string[], known?: KnownFixture, touched: string[] = []): DrivenVerdict {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-ajs-verdict-"));
  try {
    const repo = known ? path.join(dir, "repo") : REPO_DIR;
    const { skill, baseRef } = known ? fixtureRepo(repo, known, touched) : { skill: SKILL_DIR, baseRef: "HEAD" };
    const runDir = path.join(dir, "run");
    writeRun(runDir, repo, new Set(failing), baseRef);
    const run = spawnSync(process.execPath, [path.join(skill, "bin", "verify-ajs.mts"), "verdict", runDir, "--pr", "1", ...args], { cwd: repo, encoding: "utf8" });
    const planFile = path.join(runDir, "evidence", "plan.json");
    if (!existsSync(planFile)) {
      throw new Error(`verdict exited ${run.status} without writing plan.json\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
    }
    const plan = parseJson(readFileSync(planFile, "utf8"));
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, full: field(plan, "full") ?? null };
  } finally {
    rmSync(path.join(dir, "repo", "node_modules"), { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}
