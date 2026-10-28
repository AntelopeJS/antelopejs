import { existsSync, readFileSync } from "node:fs";

import type { HttpResult } from "./evidence.mts";
import type { Check } from "./journey.mts";
import { field, type Json, type JsonRead } from "./json.mts";

interface Exited {
  exitCode: number | null;
}

/** The process exited with `code`. */
export function exitIs(result: Exited, code: number): Check {
  return { name: `exit code ${code}`, pass: result.exitCode === code, detail: `exit code ${result.exitCode}` };
}

/** The process ended on SIGINT, by exit code 130 or by the signal itself, as a shell reports both. */
export function interrupted(result: { exitCode: number | null; signal: string | null }): Check {
  return { name: "ended by SIGINT (exit 130)", pass: result.exitCode === 130 || result.signal === "SIGINT", detail: `exit code ${result.exitCode}, signal ${result.signal}` };
}

/** The process exited with any code but 0. */
export function exitFails(result: Exited): Check {
  return { name: "non-zero exit code", pass: result.exitCode !== null && result.exitCode !== 0, detail: `exit code ${result.exitCode}` };
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}

/** `text` matches `pattern`. `label` names the stream, such as stderr. */
export function has(label: string, text: string, pattern: RegExp): Check {
  return { name: `${label} matches ${pattern}`, pass: pattern.test(text), detail: excerpt(text) };
}

/** `text` does not match `pattern`. */
export function lacks(label: string, text: string, pattern: RegExp): Check {
  return { name: `${label} does not match ${pattern}`, pass: !pattern.test(text), detail: excerpt(text) };
}

/** A file or folder exists at `file`. */
export function exists(file: string): Check {
  return { name: `${file} exists`, pass: existsSync(file), detail: existsSync(file) ? "present" : "missing" };
}

/** Nothing exists at `file`. */
export function absent(file: string): Check {
  return { name: `${file} is absent`, pass: !existsSync(file), detail: existsSync(file) ? "present" : "missing" };
}

/** The file at `file` matches `pattern`. */
export function fileHas(file: string, pattern: RegExp): Check {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  return { name: `${file} matches ${pattern}`, pass: pattern.test(text), detail: excerpt(text) };
}

/** Two values are deeply equal once serialized. */
export function equal(name: string, actual: JsonRead, expected: JsonRead): Check {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  return { name, pass: left === right, detail: `expected ${right}, got ${left}` };
}

/** The GET answered 200 and its JSON `key` is `expected`. */
export function answers(result: HttpResult, key: string, expected: Json): Check {
  const actual = field(result.json, key);
  return {
    name: `GET ${result.url} answers 200 with ${key} ${JSON.stringify(expected)}`,
    pass: result.status === 200 && JSON.stringify(actual) === JSON.stringify(expected),
    detail: result.error ?? `status ${result.status}, body ${excerpt(result.body)}`,
  };
}

/** The GET got no HTTP answer. */
export function refused(result: HttpResult): Check {
  return { name: `GET ${result.url} is refused`, pass: result.status === null, detail: result.error ?? `status ${result.status}` };
}

/** No tree line was added or removed. */
export function unchanged(before: string[], after: string[]): Check {
  const added = after.filter((line) => !before.includes(line));
  const removed = before.filter((line) => !after.includes(line));
  return {
    name: "file tree unchanged",
    pass: added.length === 0 && removed.length === 0,
    detail: added.length + removed.length === 0 ? "identical" : `added ${added.join(", ")}; removed ${removed.join(", ")}`,
  };
}
