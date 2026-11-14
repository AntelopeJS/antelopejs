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
