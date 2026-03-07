import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function makeTempDir(prefix = "antelopejs-") {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function cleanupTempDir(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

export function writeJson(filePath: string, data: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}
