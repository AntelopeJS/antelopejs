import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import config, { type DoorKind } from "../../verify.config.ts";
import { FEATURE_JOURNEYS } from "../journeys/index.mts";
import { flaggedDoors } from "./doors.mts";
import { field, isPrintable, isText, type Json, type JsonRead, parseJson } from "./json.mts";
import { formalGate, readFormalResult, touchedFormalChecks } from "./formal.mts";
import type { JourneyResult } from "./journey.mts";
import { planFor, type Plan, SMOKE_FEATURE } from "./map.mts";
import { REPO_DIR, type RunState, SKILL_DIR } from "./run.mts";

/** The overall result a verdict carries. */
export type VerdictResult = "PASS" | "PASS+NOTES" | "FAIL";

/** One row of the One-way doors section. */
export interface DoorRow {
  kind: DoorKind;
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
  falsePositives: FalsePositive[];
  verifier: string;
}

/** A file the door path rules flag that the verifier judged is not a door, with why. */
export interface FalsePositive {
  kind: DoorKind;
  location: string;
  reason: string;
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

const CONTAINED_KINDS = new Set<DoorKind>(["data", "format"]);

function isDoorKind(value: string): value is DoorKind {
  return Object.hasOwn(config.doors, value);
}

function doorKind(value: string, label: string): DoorKind {
  if (!isDoorKind(value)) {
    throw new Error(`judgement.json: ${label} is "${value}", not one of ${Object.keys(config.doors).join(", ")}`);
  }
  return value;
}

/** The text of a JSON value: a string as is, a number or a boolean as it prints, and a thrown error for anything else. */
function textOf(value: Json, label: string): string {
  if (isText(value)) {
    return value;
  }
  if (isPrintable(value)) {
    return String(value);
  }
  throw new Error(`judgement.json: ${label} must be a string`);
}

/** A string member the old reader trimmed, so a number or a boolean was never accepted: `undefined` when the member is absent or `null`, and a thrown error for anything but a string. */
function optionalString(parent: JsonRead, key: string, label: string): string | undefined {
  const found = field(parent, key);
  if (found === undefined || found === null) {
    return undefined;
  }
  if (!isText(found)) {
    throw new Error(`judgement.json: ${label} must be a string`);
  }
  return found;
}

/** A text member, `undefined` when the member is absent or `null`, and a thrown error when it holds an object, an array or another unprintable value. */
function optionalText(parent: JsonRead, key: string, label: string): string | undefined {
  const found = field(parent, key);
  if (found === undefined || found === null) {
    return undefined;
  }
  return textOf(found, label);
}

/** A text member the old reader only tested for truthiness: `undefined` for an absent, `null`, empty, `0` or `false` member, the text of any other number, boolean or string, and a thrown error otherwise. */
function presentText(parent: JsonRead, key: string, label: string): string | undefined {
  const found = field(parent, key);
  return found ? textOf(found, label) : undefined;
}

/** The items of an array member, none when the member is absent or `null`, and a thrown error when it holds anything else. */
function optionalItems(parent: JsonRead, key: string, label: string): Json[] {
  const found = field(parent, key);
  if (found === undefined || found === null) {
    return [];
  }
  if (!Array.isArray(found)) {
    throw new Error(`judgement.json: ${label} must be an array`);
  }
  return found;
}

function optionalTexts(parent: JsonRead, key: string, label: string): string[] {
  return optionalItems(parent, key, label).map((entry, index) => textOf(entry, `${label}[${index}]`));
}

function parseFalsePositives(doors: JsonRead): FalsePositive[] {
  return optionalItems(doors, "falsePositives", "doors.falsePositives").map((entry, index) => {
    const label = `doors.falsePositives[${index}]`;
    const location = presentText(entry, "location", `${label}.location`);
    const reason = optionalString(entry, "reason", `${label}.reason`);
    if (!location || !reason?.trim()) {
      throw new Error(`judgement.json: ${label} needs location and reason`);
    }
    return { kind: doorKind(optionalString(entry, "kind", `${label}.kind`) ?? "", `${label}.kind`), location, reason };
  });
}

function parseRows(doors: JsonRead): DoorRow[] {
  return optionalItems(doors, "rows", "doors.rows").map((row, index) => {
    const label = `doors.rows[${index}]`;
    const kind = optionalString(row, "kind", `${label}.kind`);
    const location = presentText(row, "location", `${label}.location`);
    const irreversible = presentText(row, "irreversible", `${label}.irreversible`);
    const containment = presentText(row, "containment", `${label}.containment`);
    if (!kind || !location || !irreversible || !containment) {
      throw new Error(`judgement.json: ${label} needs kind, location, irreversible and containment`);
    }
    return {
      kind: doorKind(kind, `${label}.kind`),
      location,
      irreversible,
      containment,
      containmentJourney: presentText(row, "containmentJourney", `${label}.containmentJourney`) ?? "",
    };
  });
}

function parseDocs(raw: JsonRead): DocsJudgement[] {
  return optionalItems(raw, "docs", "docs").map((entry, index) => {
    const page = optionalText(entry, "page", `docs[${index}].page`);
    if (page === undefined) {
      throw new Error(`judgement.json: docs[${index}] needs page`);
    }
    return { page, matches: field(entry, "matches") === true, note: presentText(entry, "note", `docs[${index}].note`) ?? "" };
  });
}

/** Parses evidence/judgement.json. A verdict without a One-way doors section is void, so a missing one throws. */
export function readJudgement(file: string): Judgement {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing: write the verifier's judgement before rendering the verdict`);
  }
  const raw = parseJson(readFileSync(file, "utf8"));
  if (raw === undefined) {
    throw new Error(`judgement.json: ${file} is not JSON`);
  }
  const doors = field(raw, "doors");
  const rows = parseRows(doors);
  const none = optionalString(doors, "none", "doors.none")?.trim() || null;
  if (!none && rows.length === 0) {
    throw new Error("judgement.json: doors needs `none` with a reason or at least one row; a verdict without it is void");
  }
  const verifier = optionalString(raw, "verifier", "verifier")?.trim();
  if (!verifier) {
    throw new Error("judgement.json: verifier must say who judged this run, for example the verifier thread's URL");
  }

  return {
    notVerified: optionalTexts(raw, "notVerified", "notVerified"),
    attention: optionalTexts(raw, "attention", "attention"),
    docs: parseDocs(raw),
    doorsNone: none,
    verifier,
    doors: rows,
    falsePositives: parseFalsePositives(doors),
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
    const allowed = config.doors[row.kind]?.containments ?? [];
    const journey = results.get(row.containmentJourney);
    if (!allowed.includes(row.containmentJourney)) {
      reasons.push(`${row.kind} door at ${row.location} names ${row.containmentJourney || "no journey"}; its containment must be one of ${allowed.join(", ")}`);
    } else if (!journey || journey.status !== "PASS") {
      reasons.push(`${row.kind} door at ${row.location}: containment journey ${row.containmentJourney} did not pass in this run`);
    }
  }
  for (const door of flaggedDoors(plan.changed)) {
    for (const file of door.files) {
      const listed = judgement.doors.some((row) => row.kind === door.kind && row.location.includes(file));
      const dismissed = judgement.falsePositives.some((entry) => entry.kind === door.kind && entry.location === file);
      if (!listed && !dismissed) {
        reasons.push(`path rules flag a ${door.kind} door at ${file} that the One-way doors section neither lists nor dismisses`);
      }
    }
  }
  return { reasons, attention };
}

function doorsSection(judgement: Judgement): string[] {
  const dismissed = judgement.falsePositives.map((entry) => `- Not a door: \`${entry.location}\` matches the ${entry.kind} path rules. ${entry.reason}`);
  if (judgement.doors.length === 0) {
    return [`None: ${judgement.doorsNone}`, ...dismissed];
  }
  return [
    ...dismissed,
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
    const results = readResults(state, feature) ?? [];
    const registered = (FEATURE_JOURNEYS.get(feature) ?? []).map((journey) => journey.id);
    for (const id of registered.filter((journey) => !results.some((result) => result.journey === journey))) {
      reasons.push(`${feature}/${id} was not run`);
    }
    for (const result of results) {
      if (!registered.includes(result.journey)) {
        reasons.push(`${feature}/${result.journey} is not a registered journey`);
      }
      byJourney.set(`${feature}/${result.journey}`, result);
      if (result.status === "FAIL") {
        reasons.push(`${feature}/${result.journey} failed`);
      }
      rows.push(`| ${feature} | \`${result.journey}\`: ${result.entryPoint} | ${result.status === "PASS" ? "pass" : "**fail**"}: ${result.title} | [${result.folder}](${evidenceUrl(pr, plan.headSha, result.folder)}) |`);
    }
  }
  return { rows, reasons, byJourney };
}

function formalSection(state: RunState, plan: Plan, pr: number) {
  const reasons: string[] = [];
  const lines: string[] = [];
  const touched = touchedFormalChecks(plan.changed).map((check) => check.name);
  for (const check of config.formal) {
    const result = readFormalResult(state, check.name);
    const gate = touched.includes(check.name);
    if (!result) {
      if (gate) {
        reasons.push(`formal check ${check.name} covers the diff but was not run`);
      }
      continue;
    }
    if (gate && !result.behaviour && result.exitCode === 0) {
      reasons.push(`formal check ${check.name} covers the diff but its run did not compare the covered behaviour with the base`);
    }
    const weight = formalGate(result);
    if (gate && weight.fails) {
      reasons.push(`formal check ${check.name}: ${weight.outcome}`);
    }
    const summary = gate ? weight.outcome : result.violated.length > 0 ? `violated: ${result.violated.join(", ")}` : `exit ${result.exitCode}, no violated rule`;
    lines.push(`\`${check.name}\` (${gate ? "covers the diff, gates the verdict" : "does not cover the diff, informational"}): ${summary}. [evidence](${evidenceUrl(pr, plan.headSha, result.folder)})`);
  }
  return { reasons, lines };
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
  const formal = formalSection(state, plan, pr);
  reasons.push(...doors.reasons, ...formal.reasons);
  const attention = [...judgement.attention, ...doors.attention];
  const result: VerdictResult = reasons.length > 0 ? "FAIL" : judgement.notVerified.length + attention.length > 0 ? "PASS+NOTES" : "PASS";
  const touched = plan.touched.map((entry) => `\`${entry.feature}\` (diff: ${entry.files.map((file) => `\`${file}\``).join(", ")})`);
  const markdown = [
    `## Verify: ${result}`,
    "",
    `**Head** \`${short(plan.headSha)}\` · **Skill** \`verify-antelopejs\` @ \`${short(skillSha)}\` (not trusted yet) · **Verifier** ${judgement.verifier}`,
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
    "### Formal checks",
    ...bullets(formal.lines, "None ran."),
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
