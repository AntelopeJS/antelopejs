import assert from "node:assert/strict";
import { test } from "node:test";

import { driveVerdict } from "./helpers/verdict-run.mts";

await test("verdict --all fails on a failing journey of a feature the diff does not touch and records full as all", () => {
  const driven = driveVerdict(["config/config-set-get"], ["--all"]);
  assert.equal(driven.status, 1);
  assert.match(driven.stdout, /- config\/config-set-get failed/);
  assert.match(driven.stdout, /every other feature: pre-release run/);
  assert.deepEqual(driven.full, { reason: "all" });
});

await test("verdict without --all gates on the smoke journey alone when the diff is empty", () => {
  const driven = driveVerdict(["config/config-set-get"], []);
  assert.equal(driven.status, 0);
  assert.equal(driven.full, null);
  assert.doesNotMatch(driven.stdout, /config-set-get/);
});

const KNOWN = { "project-dev": ["dev-readd-root-module"] };

await test("a failing known journey of an untouched feature is reported as a known finding and does not fail the full set", () => {
  const driven = driveVerdict(["project-dev/dev-readd-root-module"], ["--all"], KNOWN);
  assert.equal(driven.status, 0);
  assert.match(driven.stdout, /### Known findings\n- `project-dev\/dev-readd-root-module` fails on main/);
  assert.match(driven.stdout, /\| known finding: /);
  assert.doesNotMatch(driven.stdout, /### Why it fails/);
});

await test("a known journey that passes is not listed as a known finding", () => {
  const driven = driveVerdict([], ["--all"], KNOWN);
  assert.equal(driven.status, 0);
  assert.doesNotMatch(driven.stdout, /### Known findings/);
});

await test("a known journey does not excuse a non-known failure in the same full set", () => {
  const driven = driveVerdict(["project-dev/dev-readd-root-module", "project-dev/dev-call-stop"], ["--all"], KNOWN);
  assert.equal(driven.status, 1);
  assert.match(driven.stdout, /- project-dev\/dev-call-stop failed/);
  assert.doesNotMatch(driven.stdout, /- project-dev\/dev-readd-root-module failed/);
});
