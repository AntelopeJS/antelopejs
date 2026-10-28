import { readFileSync } from "node:fs";
import path from "node:path";

import config from "../../verify.config.ts";

/** The one-way door kinds whose path rules a set of changed files hits, with the files per kind. */
export function flaggedDoors(files: string[]): { kind: string; files: string[] }[] {
  return Object.entries(config.doors).flatMap(([kind, rule]) => {
    const hits = rule ? files.filter((file) => rule.globs.some((glob) => path.matchesGlob(file, glob))) : [];
    return hits.length > 0 ? [{ kind, files: hits }] : [];
  });
}

/** The files a unified diff changes, read from its `+++ b/` headers. */
export function patchFiles(patch: string): string[] {
  return [...readFileSync(patch, "utf8").matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
}

/** The `One-way-door:` line for a set of flagged kinds, or nothing when none is flagged. */
export function doorLine(doors: { kind: string }[]): string {
  return doors.length > 0 ? `One-way-door: ${doors.map((door) => door.kind).join(", ")}` : "";
}
