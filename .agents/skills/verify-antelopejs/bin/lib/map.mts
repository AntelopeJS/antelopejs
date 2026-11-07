import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import config from "../../verify.config.ts";
import { FEATURE_JOURNEYS } from "../journeys/index.mts";
import { REPO_DIR, SKILL_DIR } from "./run.mts";

/** The files whose change a user can observe. A changed file here that no feature covers is an unmapped surface. */
export const USER_FACING = ["src/**"];

/** The feature that always runs, whatever the diff touches. */
export const SMOKE_FEATURE = "smoke";

/**
 * One feature file of the map, parsed from its frontmatter. `known` lists the
 * journeys that fail on main on purpose, each a documented finding.
 */
export interface Feature {
  name: string;
  file: string;
  covers: string[];
  docs: string[];
  known: string[];
  body: string;
}

const FEATURES_DIR = path.join(SKILL_DIR, "features");

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
        known: lists.get("known") ?? [],
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

/** The `known:` ids of a feature that are not among its registered journeys. */
export function unregisteredKnown(feature: Feature, registered: string[]): string[] {
  return feature.known.filter((id) => !registered.includes(id));
}

/**
 * Whether a failing journey is a known finding the diff does not answer for:
 * the feature lists it under `known:` and the diff touches no file the feature
 * covers. A journey of a touched feature is never a known finding.
 */
export function knownFinding(features: Feature[], touched: Selection["touched"], feature: string, journey: string): boolean {
  const listed = features.some((entry) => entry.name === feature && entry.known.includes(journey));
  return listed && !touched.some((entry) => entry.feature === feature);
}

/**
 * Checks the map against the repository: every user-facing file is covered,
 * every feature has journeys, every journey is named in its feature file,
 * every `known:` id is a journey of its feature, and every docs path exists.
 * Returns one line per problem.
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
    for (const id of unregisteredKnown(feature, (journeys ?? []).map((journey) => journey.id))) {
      problems.push(`${feature.file}: known journey \`${id}\` is not a registered journey of ${feature.name}`);
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
  }
  for (const glob of config.shared) {
    if (!trackedFiles().some((tracked) => path.matchesGlob(tracked, glob))) {
      problems.push(`verify.config.ts: shared glob ${glob} matches no tracked file`);
    }
  }
  for (const name of FEATURE_JOURNEYS.keys()) {
    if (!features.some((feature) => feature.name === name)) {
      problems.push(`journeys of ${name} have no features/${name}.md`);
    }
  }
  return problems;
}

/** Why a plan runs every feature: `--all` asked for it, or the diff changed these shared files. */
export type FullSet = { reason: "all" } | { reason: "shared"; files: string[] };

/** The features a set of changed files asks a verdict to run. */
export interface Selection {
  touched: { feature: string; files: string[] }[];
  unmapped: string[];
  docs: string[];
  full: FullSet | null;
  run: string[];
}

/** What a diff asks a verdict to run. */
export interface Plan extends Selection {
  baseRef: string;
  baseSha: string;
  headSha: string;
  changed: string[];
}

/**
 * Maps changed files onto features: every touched feature plus the smoke
 * journey runs, every feature runs when `all` is set or a changed file
 * matches a `shared` glob, and a user-facing file outside every feature
 * glob is an unmapped surface. Docs are those of the touched features only.
 */
export function selectFeatures(changed: string[], features: Feature[], options: { all: boolean; shared: string[] }): Selection {
  const touched = features
    .map((feature) => ({ feature: feature.name, files: changed.filter((file) => matches(file, feature.covers)) }))
    .filter((entry) => entry.files.length > 0);
  const unmapped = changed.filter((file) => matches(file, USER_FACING) && featuresOf(file, features).length === 0);
  const docs = [...new Set(features.filter((feature) => touched.some((entry) => entry.feature === feature.name)).flatMap((feature) => feature.docs))];
  const sharedFiles = changed.filter((file) => matches(file, options.shared));
  const full: FullSet | null = options.all ? { reason: "all" } : sharedFiles.length > 0 ? { reason: "shared", files: sharedFiles } : null;
  const selected = full ? features.map((feature) => feature.name) : touched.map((entry) => entry.feature);
  const run = [SMOKE_FEATURE, ...selected.filter((name) => name !== SMOKE_FEATURE)];
  return { touched, unmapped, docs, full, run };
}

/**
 * The files changed from `baseSha` to HEAD in the repository at `cwd`. A
 * rename counts as the deletion of the old name and the addition of the new
 * one, so a shared or covered file renamed away still matches its globs.
 */
export function changedFiles(cwd: string, baseSha: string): string[] {
  return execFileSync("git", ["diff", "--name-only", "--no-renames", `${baseSha}...HEAD`], { cwd, encoding: "utf8" }).split("\n").filter(Boolean);
}

/**
 * Maps the diff from the merge base of `baseRef` to HEAD onto features with
 * {@link selectFeatures}. `all` is required so that no caller drops the
 * pre-release mode by omission.
 */
export function planFor(baseRef: string, all: boolean): Plan {
  const git = (args: string[]) => execFileSync("git", args, { cwd: REPO_DIR, encoding: "utf8" }).trim();
  const baseSha = git(["merge-base", baseRef, "HEAD"]);
  const changed = changedFiles(REPO_DIR, baseSha);
  const selection = selectFeatures(changed, readFeatures(), { all, shared: config.shared });
  return { baseRef, baseSha, headSha: git(["rev-parse", "HEAD"]), changed, ...selection };
}
