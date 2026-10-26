import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function makeTempDir(prefix = "antelopejs-") {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function cleanupTempDir(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

export function writeJson<T>(filePath: string, data: T) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

export function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(readText(filePath));
}

export function listDirectory(dir: string): string[] {
  return readdirSync(dir);
}
