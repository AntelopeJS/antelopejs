import assert from "node:assert/strict";
import { test } from "node:test";

import { breakCoverageProblems } from "./break-coverage.mts";

const features = [
  { name: "project-build", file: "features/project-build.md", covers: ["src/core/runtime/build-*.ts"] },
  { name: "project-dev", file: "features/project-dev.md", covers: ["src/cli/commands/shared/project-command.ts"] },
  { name: "smoke", file: "features/smoke.md", covers: [] },
];

await test("a break that edits a file only another feature covers is reported (catches a map that checks only that some feature covers it)", () => {
  const problems = breakCoverageProblems(features, (name) => (name === "project-build" ? ["src/cli/commands/shared/project-command.ts"] : []), "smoke");
  assert.deepEqual(problems, ["features/project-build.md: its seeded break edits src/cli/commands/shared/project-command.ts, which its covers globs miss, so plan would not run it"]);
});

await test("a break inside its own feature's globs passes (catches exact-path matching instead of globs)", () => {
  assert.deepEqual(breakCoverageProblems(features, (name) => (name === "project-build" ? ["src/core/runtime/build-runtime.ts"] : []), "smoke"), []);
});

await test("the smoke feature is exempt, because it runs on every verdict (catches a rule that fails smoke's empty covers)", () => {
  assert.deepEqual(breakCoverageProblems(features, (name) => (name === "smoke" ? ["src/cli/index.ts"] : []), "smoke"), []);
});
