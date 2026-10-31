import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { expect } from "chai";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JsonValue } from "./json";

export function makeTempDir(prefix = "antelopejs-") {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function cleanupTempDir(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

export function writeJson(filePath: string, data: JsonValue) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

/** Starts an assertion on the JSON in a file; the parsed value is compared, never read through a type. */
export function expectJsonFile(filePath: string) {
  return expect(JSON.parse(readText(filePath)));
}

export function listDirectory(dir: string): string[] {
  return readdirSync(dir);
}
