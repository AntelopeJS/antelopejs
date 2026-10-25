import path from "node:path";
import { tmpdir } from "node:os";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

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

export function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

export function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(readText(filePath)) as T;
}

export function listDirectory(dir: string): string[] {
  return readdirSync(dir);
}
