import assert from "node:assert/strict";
import { test } from "node:test";

import { type Feature, selectFeatures } from "./map.mts";

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
