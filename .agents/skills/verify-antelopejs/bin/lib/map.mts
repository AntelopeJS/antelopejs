import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { FEATURE_JOURNEYS } from "../journeys/index.mts";
import { breakCoverageProblems } from "./break-coverage.mts";
import { patchFiles } from "./doors.mts";
import { REPO_DIR, SKILL_DIR } from "./run.mts";

/** The files whose change a user can observe. A changed file here that no feature covers is an unmapped surface. */
export const USER_FACING = ["src/**"];

/** The feature that always runs, whatever the diff touches. */
export const SMOKE_FEATURE = "smoke";

/** One feature file of the map, parsed from its frontmatter. */
export interface Feature {
  name: string;
  file: string;
  covers: string[];
  docs: string[];
  body: string;
}

const FEATURES_DIR = path.join(SKILL_DIR, "features");
const SEEDED_BREAKS_DIR = path.join(SKILL_DIR, "seeded-breaks");

function frontmatterLists(text: string): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  let current: string[] | undefined;
  for (const line of (match?.[1] ?? "").split("\n")) {
    const key = /^(\w+):\s*$/.exec(line);
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (key) {
      current = [];
      lists.set(key[1], current);
    } else if (item && current) {
      current.push(item[1].replace(/^"|"$/g, ""));
    }
  }
  return lists;
}

/** Reads every feature file under features/, README.md excluded. */
export function readFeatures(): Feature[] {
  return readdirSync(FEATURES_DIR)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort()
    .map((file) => {
      const text = readFileSync(path.join(FEATURES_DIR, file), "utf8");
      const lists = frontmatterLists(text);
      return {
        name: file.replace(/\.md$/, ""),
        file: path.relative(REPO_DIR, path.join(FEATURES_DIR, file)),
        covers: lists.get("covers") ?? [],
        docs: lists.get("docs") ?? [],
        body: text,
      };
    });
}

function matches(file: string, globs: string[]): boolean {
  return globs.some((glob) => path.matchesGlob(file, glob));
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: REPO_DIR, encoding: "utf8" }).split("\n").filter(Boolean);
}

/** The features whose globs cover `file`. */
export function featuresOf(file: string, features: Feature[]): string[] {
  return features.filter((feature) => matches(file, feature.covers)).map((feature) => feature.name);
}

/**
 * Checks the map against the repository: every user-facing file is covered,
 * every feature has journeys and a seeded break that edits only files its
 * own globs cover, every journey is named in
 * its feature file, and every docs path exists. Returns one line per problem.
 */
export function checkMap(): string[] {
  const features = readFeatures();
  const problems: string[] = [];
  for (const file of trackedFiles().filter((tracked) => matches(tracked, USER_FACING))) {
    if (featuresOf(file, features).length === 0) {
      problems.push(`unmapped: ${file} matches no feature glob`);
    }
  }
  for (const feature of features) {
    const journeys = FEATURE_JOURNEYS.get(feature.name);
    if (!journeys) {
      problems.push(`${feature.file}: no journeys registered in bin/journeys/index.mts`);
    }
    for (const journey of journeys ?? []) {
      if (!feature.body.includes(`\`${journey.id}\``)) {
        problems.push(`${feature.file}: journey \`${journey.id}\` is not described`);
      }
    }
    if (feature.name !== SMOKE_FEATURE && feature.covers.length === 0) {
      problems.push(`${feature.file}: lists no covers globs`);
    }
    for (const glob of feature.covers) {
      if (!trackedFiles().some((tracked) => path.matchesGlob(tracked, glob))) {
        problems.push(`${feature.file}: glob ${glob} matches no tracked file`);
      }
    }
    for (const doc of feature.docs) {
      if (!existsSync(path.join(REPO_DIR, doc))) {
        problems.push(`${feature.file}: docs path ${doc} does not exist`);
      }
    }
    if (!existsSync(path.join(SEEDED_BREAKS_DIR, `${feature.name}.patch`))) {
      problems.push(`${feature.file}: seeded-breaks/${feature.name}.patch is missing`);
    }
  }
  for (const name of FEATURE_JOURNEYS.keys()) {
    if (!features.some((feature) => feature.name === name)) {
      problems.push(`journeys of ${name} have no features/${name}.md`);
    }
  }
  const breakFiles = (name: string) => {
    const patch = path.join(SEEDED_BREAKS_DIR, `${name}.patch`);
    return existsSync(patch) ? patchFiles(patch) : [];
  };
  return [...problems, ...breakCoverageProblems(features, breakFiles, SMOKE_FEATURE)];
}

/** What a diff asks a verdict to run. */
export interface Plan {
  baseRef: string;
  baseSha: string;
  headSha: string;
  changed: string[];
  touched: { feature: string; files: string[] }[];
  unmapped: string[];
  docs: string[];
  run: string[];
}

/**
 * Maps the diff from the merge base of `baseRef` to HEAD onto features:
 * every touched feature plus the smoke journey runs, and a user-facing
 * file outside every glob is an unmapped surface.
 */
export function planFor(baseRef: string): Plan {
  const features = readFeatures();
  const git = (args: string[]) => execFileSync("git", args, { cwd: REPO_DIR, encoding: "utf8" }).trim();
  const baseSha = git(["merge-base", baseRef, "HEAD"]);
  const changed = git(["diff", "--name-only", `${baseSha}...HEAD`]).split("\n").filter(Boolean);
  const touched = features
    .map((feature) => ({ feature: feature.name, files: changed.filter((file) => matches(file, feature.covers)) }))
    .filter((entry) => entry.files.length > 0);
  const unmapped = changed.filter((file) => matches(file, USER_FACING) && featuresOf(file, features).length === 0);
  const docs = [...new Set(features.filter((feature) => touched.some((entry) => entry.feature === feature.name)).flatMap((feature) => feature.docs))];
  const run = [SMOKE_FEATURE, ...touched.map((entry) => entry.feature).filter((name) => name !== SMOKE_FEATURE)];
  return { baseRef, baseSha, headSha: git(["rev-parse", "HEAD"]), changed, touched, unmapped, docs, run };
}
