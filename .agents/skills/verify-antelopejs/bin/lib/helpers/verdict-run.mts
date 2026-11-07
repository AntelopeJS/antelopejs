import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FEATURE_JOURNEYS } from "../../journeys/index.mts";
import { field, type JsonRead, parseJson } from "../json.mts";
import { REPO_DIR, SKILL_DIR } from "../run.mts";
import { REPOSITORY_ENV } from "../verdict.mts";

/** What the `verdict` command printed and recorded for a crafted run. */
export interface DrivenVerdict {
  status: number | null;
  stdout: string;
  stderr: string;
  full: JsonRead;
}

const JUDGEMENT = { doors: { none: "test", rows: [] }, docs: [], notVerified: [], attention: [], verifier: "verdict test" };

function writeRun(dir: string, failing: Set<string>): void {
  const evidence = path.join(dir, "evidence");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_DIR, encoding: "utf8" }).trim();
  mkdirSync(evidence, { recursive: true });
  const state = { id: "x", dir, home: path.join(dir, "home"), work: path.join(dir, "work"), evidence, manifestUrl: "file:///x", createdAt: new Date().toISOString(), headSha: head, baseRef: "HEAD", baseSha: "", baseCli: "", processes: [] };
  writeFileSync(path.join(dir, "run.json"), JSON.stringify(state));
  for (const [feature, journeys] of FEATURE_JOURNEYS) {
    mkdirSync(path.join(evidence, feature), { recursive: true });
    const results = journeys.map((journey) => ({ feature, journey: journey.id, title: journey.title, entryPoint: journey.entryPoint, status: failing.has(`${feature}/${journey.id}`) ? "FAIL" : "PASS", steps: [], error: null, folder: `${feature}/${journey.id}` }));
    writeFileSync(path.join(evidence, feature, "feature.json"), JSON.stringify(results));
  }
  writeFileSync(path.join(evidence, "judgement.json"), JSON.stringify(JUDGEMENT));
}

/**
 * Crafts a run whose base is HEAD, so the diff is empty, with the named
 * `<feature>/<journey>` results failing and every other journey passing, and
 * drives `verify-ajs verdict` on it with `args`. The repository the evidence
 * links name is set through `VERIFY_AJS_REPOSITORY`, so the run needs no
 * GitHub origin remote. Throws with the verdict's stderr when it wrote no plan.
 */
export function driveVerdict(failing: string[], args: string[]): DrivenVerdict {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-ajs-verdict-"));
  try {
    writeRun(dir, new Set(failing));
    const env = { ...process.env, [REPOSITORY_ENV]: "owner/repo" };
    const run = spawnSync(process.execPath, [path.join(SKILL_DIR, "bin", "verify-ajs.mts"), "verdict", dir, "--pr", "1", ...args], { cwd: REPO_DIR, encoding: "utf8", env });
    const planFile = path.join(dir, "evidence", "plan.json");
    if (!existsSync(planFile)) {
      throw new Error(`verdict exited ${run.status} without writing plan.json\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
    }
    const plan = parseJson(readFileSync(planFile, "utf8"));
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, full: field(plan, "full") ?? null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
