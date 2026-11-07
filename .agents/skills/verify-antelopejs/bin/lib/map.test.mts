import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { changedFiles, type Feature, knownAtBase, knownFinding, selectFeatures, unregisteredKnown } from "./map.mts";

function feature(name: string, covers: string[], docs: string[] = [], known: string[] = []): Feature {
  return { name, file: `features/${name}.md`, covers, docs, known, body: "" };
}

const FEATURES = [feature("cli-shell", ["src/cli/*.ts"], ["docs/cli.md"]), feature("project-dev", ["src/core/runtime/**"], ["docs/dev.md"], ["dev-watch"]), feature("smoke", [])];
const SHARED = ["package.json", "pnpm-lock.yaml"];

await test("a diff that changes a shared file runs every feature and names the shared file", () => {
  const selection = selectFeatures(["pnpm-lock.yaml", "README.md"], FEATURES, { all: false, shared: SHARED });
  assert.deepEqual(selection.run, ["smoke", "cli-shell", "project-dev"]);
  assert.deepEqual(selection.full, { reason: "shared", files: ["pnpm-lock.yaml"] });
  assert.deepEqual(selection.docs, []);
});

await test("a diff of covered files runs the touched features and smoke, not the full set", () => {
  const selection = selectFeatures(["src/cli/main.ts"], FEATURES, { all: false, shared: SHARED });
  assert.deepEqual(selection.run, ["smoke", "cli-shell"]);
  assert.equal(selection.full, null);
  assert.deepEqual(selection.docs, ["docs/cli.md"]);
});

await test("a nested file named like a shared file does not run the full set", () => {
  const selection = selectFeatures(["playground/package.json", "fixtures/template/pnpm-lock.yaml"], FEATURES, { all: false, shared: SHARED });
  assert.deepEqual(selection.run, ["smoke"]);
  assert.equal(selection.full, null);
});

await test("--all runs every feature on an empty diff and says it was asked for", () => {
  const selection = selectFeatures([], FEATURES, { all: true, shared: SHARED });
  assert.deepEqual(selection.run, ["smoke", "cli-shell", "project-dev"]);
  assert.deepEqual(selection.full, { reason: "all" });
});

const KNOWN = new Set(["project-dev/dev-watch"]);

await test("a known journey of a feature the diff does not touch is a known finding", () => {
  const touched = selectFeatures(["pnpm-lock.yaml"], FEATURES, { all: false, shared: SHARED }).touched;
  assert.equal(knownFinding(KNOWN, touched, "project-dev", "dev-watch"), true);
});

await test("a known journey of a touched feature is not a known finding, so it fails the verdict", () => {
  const touched = selectFeatures(["src/core/runtime/dev.ts"], FEATURES, { all: false, shared: SHARED }).touched;
  assert.equal(knownFinding(KNOWN, touched, "project-dev", "dev-watch"), false);
});

await test("a journey that is not listed as known, or that another feature lists, is not a known finding", () => {
  assert.equal(knownFinding(KNOWN, [], "project-dev", "dev-call-stop"), false);
  assert.equal(knownFinding(KNOWN, [], "cli-shell", "dev-watch"), false);
});

function repositoryWithFeatureFiles(base: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-ajs-known-"));
  git(dir, ["init", "--quiet"]);
  mkdirSync(path.join(dir, "features"));
  for (const [name, text] of Object.entries(base)) {
    writeFileSync(path.join(dir, "features", `${name}.md`), text);
  }
  writeFileSync(path.join(dir, "keep"), "x\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "--quiet", "-m", "base"]);
  return { dir, base: git(dir, ["rev-parse", "HEAD"]) };
}

function featureFile(known: string[]): string {
  return `---\ncovers:\n  - "src/**"\n${known.length > 0 ? `known:\n${known.map((id) => `  - ${id}\n`).join("")}` : ""}---\nbody\n`;
}

const AT_HEAD = (known: string[]) => [{ ...feature("project-init", ["src/**"], [], known), file: "features/project-init.md" }];

await test("a known id that the diff adds to a feature file does not excuse the failure the same diff causes", () => {
  const { dir, base } = repositoryWithFeatureFiles({ "project-init": featureFile([]) });
  try {
    const known = knownAtBase(dir, base, AT_HEAD(["init-flags"]));
    assert.deepEqual([...known], []);
    assert.equal(knownFinding(known, [], "project-init", "init-flags"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("an id the base lists stays known, and one HEAD removes or the base never listed does not", () => {
  const { dir, base } = repositoryWithFeatureFiles({ "project-init": featureFile(["init-flags", "init-yes"]) });
  try {
    assert.deepEqual([...knownAtBase(dir, base, AT_HEAD(["init-flags", "init-cancel"]))], ["project-init/init-flags"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("a feature file missing at the base contributes no known id", () => {
  const { dir, base } = repositoryWithFeatureFiles({ other: featureFile(["x"]) });
  try {
    assert.deepEqual([...knownAtBase(dir, base, AT_HEAD(["init-flags"]))], []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("a known id that is not a registered journey of its feature is reported", () => {
  const owner = feature("project-dev", [], [], ["dev-watch", "ghost", "other-feature-journey"]);
  assert.deepEqual(unregisteredKnown(owner, ["dev-watch", "dev-call-stop"]), ["ghost", "other-feature-journey"]);
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
}

function repositoryWithRenames() {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-ajs-rename-"));
  git(dir, ["init", "--quiet"]);
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, ".nvmrc"), "24\n");
  writeFileSync(path.join(dir, "src", "old.ts"), "export const answer = 42;\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "--quiet", "-m", "base"]);
  const base = git(dir, ["rev-parse", "HEAD"]);
  git(dir, ["mv", ".nvmrc", ".node-version"]);
  git(dir, ["mv", "src/old.ts", "src/new.ts"]);
  git(dir, ["commit", "--quiet", "-m", "rename"]);
  return { dir, base };
}

await test("a rename lists both names, so a shared file renamed away selects the full set", () => {
  const { dir, base } = repositoryWithRenames();
  try {
    const changed = changedFiles(dir, base);
    assert.deepEqual([...changed].sort(), [".node-version", ".nvmrc", "src/new.ts", "src/old.ts"]);
    const selection = selectFeatures(changed, FEATURES, { all: false, shared: [".nvmrc"] });
    assert.deepEqual(selection.full, { reason: "shared", files: [".nvmrc"] });
    assert.deepEqual(selection.run, ["smoke", "cli-shell", "project-dev"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("a renamed source file still touches the feature that covered its old name", () => {
  const { dir, base } = repositoryWithRenames();
  try {
    const owner = [feature("legacy", ["src/old.ts"]), feature("smoke", [])];
    const selection = selectFeatures(changedFiles(dir, base), owner, { all: false, shared: [] });
    assert.deepEqual(selection.touched, [{ feature: "legacy", files: ["src/old.ts"] }]);
    assert.deepEqual(selection.unmapped, ["src/new.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
