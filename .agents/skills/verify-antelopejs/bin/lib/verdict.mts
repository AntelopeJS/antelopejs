import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { flaggedDoors } from "./doors.mts";
import type { JourneyResult } from "./journey.mts";
import { planFor, type Plan, SMOKE_FEATURE } from "./map.mts";
import { REPO_DIR, type RunState, SKILL_DIR } from "./run.mts";

/** The overall result a verdict carries. */
export type VerdictResult = "PASS" | "PASS+NOTES" | "FAIL";

/** One row of the One-way doors section. */
export interface DoorRow {
  kind: string;
  location: string;
  irreversible: string;
  containment: string;
  containmentJourney: string;
}

/** One linked docs page and whether it still matches the behaviour. */
export interface DocsJudgement {
  page: string;
  matches: boolean;
  note: string;
}

/** What only the verifier can judge, written to evidence/judgement.json. */
export interface Judgement {
  notVerified: string[];
  attention: string[];
  docs: DocsJudgement[];
  doorsNone: string | null;
  doors: DoorRow[];
}

/** A rendered verdict and the facts it was computed from. */
export interface Verdict {
  result: VerdictResult;
  headSha: string;
  skillSha: string;
  pr: number;
  markdown: string;
  reasons: string[];
}

const CONTAINED_KINDS = new Set(["data", "format"]);

interface JudgementFile {
  notVerified?: string[];
  attention?: string[];
  docs?: { page: string; matches: boolean; note?: string }[];
  doors?: { none?: string; rows?: (Omit<DoorRow, "containmentJourney"> & { containmentJourney?: string })[] };
}

/** Parses evidence/judgement.json. A verdict without a One-way doors section is void, so a missing one throws. */
export function readJudgement(file: string): Judgement {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing: write the verifier's judgement before rendering the verdict`);
  }
  const raw: JudgementFile = JSON.parse(readFileSync(file, "utf8"));
  const rows = raw.doors?.rows ?? [];
  const none = raw.doors?.none?.trim() || null;
  if (!none && rows.length === 0) {
    throw new Error("judgement.json: doors needs `none` with a reason or at least one row; a verdict without it is void");
  }
  for (const [index, row] of rows.entries()) {
    if (!row.kind || !row.location || !row.irreversible || !row.containment) {
      throw new Error(`judgement.json: doors.rows[${index}] needs kind, location, irreversible and containment`);
    }
  }
  return {
    notVerified: raw.notVerified ?? [],
    attention: raw.attention ?? [],
    docs: (raw.docs ?? []).map((entry) => ({ page: entry.page, matches: entry.matches === true, note: entry.note ?? "" })),
    doorsNone: none,
    doors: rows.map((row) => ({ ...row, containmentJourney: row.containmentJourney ?? "" })),
  };
}

function readResults(state: RunState, feature: string): JourneyResult[] | undefined {
  const file = path.join(state.evidence, feature, "feature.json");
  if (!existsSync(file)) {
    return undefined;
  }
  const results: JourneyResult[] = JSON.parse(readFileSync(file, "utf8"));
  return results;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_DIR, encoding: "utf8" }).trim();
}

/** The GitHub `owner/repo` of the origin remote. */
export function originRepository(): string {
  const url = git(["remote", "get-url", "origin"]);
  const match = /github\.com[:/](.+?)(?:\.git)?$/.exec(url);
  if (!match) {
    throw new Error(`origin ${url} is not a GitHub repository`);
  }
  return match[1];
}

function evidenceUrl(pr: number, sha: string, relative: string): string {
  return `https://github.com/${originRepository()}/tree/verify-evidence/pr-${pr}/${sha}/${relative}`;
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

function doorReasons(judgement: Judgement, results: Map<string, JourneyResult>, plan: Plan) {
  const reasons: string[] = [];
  const attention: string[] = [];
  for (const row of judgement.doors.filter((door) => CONTAINED_KINDS.has(door.kind))) {
    const journey = results.get(row.containmentJourney);
    if (!journey || journey.status !== "PASS") {
      reasons.push(`${row.kind} door at ${row.location} has no passing containment journey (${row.containmentJourney || "none named"})`);
    }
  }
  for (const door of flaggedDoors(plan.changed)) {
    if (!judgement.doors.some((row) => row.kind === door.kind)) {
      attention.push(`Path rules flag a ${door.kind} door (${door.files.join(", ")}) that the One-way doors section does not list.`);
    }
  }
  return { reasons, attention };
}

function doorsSection(judgement: Judgement): string[] {
  if (judgement.doors.length === 0) {
    return [`None: ${judgement.doorsNone}`];
  }
  return [
    "| Kind | Location | What cannot be undone | Containment |",
    "|---|---|---|---|",
    ...judgement.doors.map((door) => `| ${door.kind} | \`${door.location}\` | ${door.irreversible} | ${door.containment}${door.containmentJourney ? ` (journey \`${door.containmentJourney}\`)` : ""} |`),
  ];
}

function bullets(entries: string[], empty: string): string[] {
  return (entries.length > 0 ? entries : [empty]).map((entry) => `- ${entry}`);
}

function journeyRows(state: RunState, plan: Plan, pr: number) {
  const rows: string[] = [];
  const reasons: string[] = [];
  const byJourney = new Map<string, JourneyResult>();
  for (const feature of plan.run) {
    const results = readResults(state, feature);
    if (!results) {
      reasons.push(`touched feature ${feature} was not run`);
    }
    for (const result of results ?? []) {
      byJourney.set(result.journey, result);
      if (result.status === "FAIL") {
        reasons.push(`${feature}/${result.journey} failed`);
      }
      rows.push(`| ${feature} | \`${result.journey}\`: ${result.entryPoint} | ${result.status === "PASS" ? "pass" : "**fail**"}: ${result.title} | [${result.folder}](${evidenceUrl(pr, plan.headSha, result.folder)}) |`);
    }
  }
  return { rows, reasons, byJourney };
}

function docsReasons(judgement: Judgement, plan: Plan): string[] {
  return plan.docs.flatMap((page) => {
    const docs = judgement.docs.find((entry) => entry.page === page);
    if (!docs) {
      throw new Error(`judgement.json: docs page ${page} of a touched feature has no judgement`);
    }
    return docs.matches ? [] : [`${page} no longer matches the behaviour`];
  });
}

/**
 * Computes the verdict of a run from its journey results, the diff plan and
 * the verifier's judgement, and writes verdict.md, verdict.json and plan.json
 * into the evidence folder.
 */
export function renderVerdict(state: RunState, pr: number, judgement: Judgement): Verdict {
  const plan = planFor(state.baseRef || "origin/main");
  const skillSha = git(["log", "-1", "--format=%H", "--", path.relative(REPO_DIR, SKILL_DIR)]) || plan.headSha;
  const reasons: string[] = [];
  if (plan.headSha !== state.headSha) {
    reasons.push(`the run was created at ${short(state.headSha)} but HEAD is ${short(plan.headSha)}`);
  }
  const journeys = journeyRows(state, plan, pr);
  reasons.push(...journeys.reasons, ...plan.unmapped.map((file) => `unmapped surface ${file}`), ...docsReasons(judgement, plan));
  const doors = doorReasons(judgement, journeys.byJourney, plan);
  reasons.push(...doors.reasons);
  const attention = [...judgement.attention, ...doors.attention];
  const result: VerdictResult = reasons.length > 0 ? "FAIL" : judgement.notVerified.length + attention.length > 0 ? "PASS+NOTES" : "PASS";
  const touched = plan.touched.map((entry) => `\`${entry.feature}\` (diff: ${entry.files.map((file) => `\`${file}\``).join(", ")})`);
  const markdown = [
    `## Verify: ${result}`,
    "",
    `**Head** \`${short(plan.headSha)}\` · **Skill** \`verify-antelopejs\` @ \`${short(skillSha)}\` (not trusted yet) · **Verifier** fresh Amp thread, not the author`,
    "",
    "### One-way doors",
    ...doorsSection(judgement),
    "",
    "### Touched features",
    ...bullets(touched, "none"),
    `- ${SMOKE_FEATURE}: init → dev → fixture call → stop`,
    "",
    ...(plan.unmapped.length > 0 ? ["### Unmapped surfaces", ...plan.unmapped.map((file) => `- \`${file}\` matches no feature glob; add it to a feature file.`), ""] : []),
    ...(reasons.length > 0 ? ["### Why it fails", ...reasons.map((reason) => `- ${reason}`), ""] : []),
    "### Journeys",
    "| Feature | Entry point | Result | Evidence |",
    "|---|---|---|---|",
    ...journeys.rows,
    "",
    "### Docs",
    ...bullets(judgement.docs.map((docs) => `\`${docs.page}\`: ${docs.matches ? "matches" : "**stale**"}${docs.note ? `. ${docs.note}` : ""}`), "No touched feature links a page."),
    "",
    "### Not verified",
    ...bullets(judgement.notVerified, "Nothing."),
    "",
    "### Attention",
    ...bullets(attention, "Nothing."),
    "",
    `Evidence: \`verify-evidence\` branch, [\`pr-${pr}/${plan.headSha}/\`](${evidenceUrl(pr, plan.headSha, "")})`,
    "",
  ].join("\n");
  writeFileSync(path.join(state.evidence, "verdict.md"), markdown);
  writeFileSync(path.join(state.evidence, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  writeFileSync(path.join(state.evidence, "verdict.json"), `${JSON.stringify({ result, headSha: plan.headSha, skillSha, pr, reasons }, null, 2)}\n`);
  return { result, headSha: plan.headSha, skillSha, pr, markdown, reasons };
}
