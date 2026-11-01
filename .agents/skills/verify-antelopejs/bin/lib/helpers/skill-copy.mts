import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { SKILL_DIR } from "../run.mts";

/**
 * Copies the verification skill into `repo` and removes one covers glob from
 * one of its features, so the feature's seeded break edits a file the feature
 * no longer covers.
 *
 * @returns The copied skill's directory
 */
export function copySkillWithoutCover(repo: string, feature: string, glob: string): string {
  const skill = path.join(repo, ".agents", "skills", "verify-antelopejs");
  mkdirSync(skill, { recursive: true });
  cpSync(SKILL_DIR, skill, { recursive: true });
  const file = path.join(skill, "features", `${feature}.md`);
  writeFileSync(file, readFileSync(file, "utf8").replace(`  - ${glob}\n`, ""));
  return skill;
}
