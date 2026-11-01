import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { copySkillWithoutCover } from "./helpers/skill-copy.mts";

await test("map reports a seeded break that edits a file outside its own feature's globs (catches a call site that never feeds the patch files to the break-coverage rule)", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "verify-ajs-map-"));
  try {
    const skill = copySkillWithoutCover(repo, "config", "src/cli/commands/config/**");
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["add", "."], { cwd: repo });
    const run = spawnSync("node", [path.join(skill, "bin", "verify-ajs.mts"), "map"], { cwd: repo, encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(`${run.stdout}${run.stderr}`, /config\.md: its seeded break edits src\/cli\/commands\/config\/keys\.ts, which its covers globs miss/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
