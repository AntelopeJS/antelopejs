import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { changedFiles, type Feature, selectFeatures } from "./map.mts";

function feature(name: string, covers: string[], docs: string[] = []): Feature {
  return { name, file: `features/${name}.md`, covers, docs, body: "" };
}

const FEATURES = [feature("cli-shell", ["src/cli/*.ts"], ["docs/cli.md"]), feature("project-dev", ["src/core/runtime/**"], ["docs/dev.md"]), feature("smoke", [])];
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
