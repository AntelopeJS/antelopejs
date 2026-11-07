import assert from "node:assert/strict";
import { test } from "node:test";

import { type FormalResult, parseFormalResult } from "./formal.mts";
import { parseJourneyResults } from "./journey.mts";
import { parseProcessRecord, parseRunState } from "./run.mts";

const RUN = {
  id: "r1",
  dir: "/run",
  home: "/run/home",
  work: "/run/work",
  evidence: "/run/evidence",
  manifestUrl: "file:///m",
  createdAt: "2026-11-02T00:00:00.000Z",
  headSha: "aaa",
  baseRef: "main",
  baseSha: "bbb",
  baseCli: "/base/cli",
};

const PROCESS = { name: "dev", pid: 12, port: 3000, cwd: "/run/work", startedAt: "2026-11-02T00:00:01.000Z" };

const JOURNEY = {
  feature: "cli",
  journey: "help",
  title: "Help",
  entryPoint: "ajs --help",
  status: "PASS",
  steps: [{ name: "run", folder: "01", checks: [{ name: "exit", pass: true, detail: "0" }] }],
  error: null,
  folder: "cli/help",
};

const FORMAL = {
  name: "lifecycle",
  exitCode: 0,
  violated: [],
  passing: ["A"],
  folder: "formal/lifecycle",
  commits: { baseSha: "b", headSha: "h" },
  behaviour: { method: "tlc", changed: true, removed: ["x"], added: [] },
  checkChanged: false,
  base: { exitCode: null, violated: ["A"], passing: [] },
  fixed: ["A"],
  missing: [],
};

function assertRoundTrip(result: FormalResult): void {
  const text = JSON.stringify(result);
  assert.equal(JSON.stringify(parseFormalResult(text)), text);
}

await test("a run.json saveRun wrote reads back unchanged", () => {
  assert.deepEqual(parseRunState(JSON.stringify(RUN)), RUN);
});

await test("a run.json with a wrong-shaped member is refused, naming the member", () => {
  assert.throws(() => parseRunState(JSON.stringify({ ...RUN, headSha: 5 })), /run\.json: headSha must be a string/);
  assert.throws(() => parseRunState("not json"), /run\.json: id must be a string/);
});

await test("a process record reads back unchanged, and a wrong-shaped one is refused, naming the field", () => {
  assert.deepEqual(parseProcessRecord(JSON.stringify(PROCESS)), PROCESS);
  assert.throws(() => parseProcessRecord(JSON.stringify({ ...PROCESS, pid: "12" })), /process record: pid must be a number/);
});

await test("a feature.json the journey runner wrote reads back unchanged", () => {
  assert.deepEqual(parseJourneyResults(JSON.stringify([JOURNEY, { ...JOURNEY, status: "FAIL", error: "boom" }])), [JOURNEY, { ...JOURNEY, status: "FAIL", error: "boom" }]);
});

await test("a feature.json with a wrong-shaped result is refused, naming the field", () => {
  assert.throws(() => parseJourneyResults(JSON.stringify({})), /expected a list of journey results/);
  assert.throws(() => parseJourneyResults(JSON.stringify([{ ...JOURNEY, status: "MAYBE" }])), /status must be PASS or FAIL, got MAYBE/);
  assert.throws(() => parseJourneyResults(JSON.stringify([{ ...JOURNEY, error: 1 }])), /feature\.json result: error must be a string/);
  assert.throws(() => parseJourneyResults(JSON.stringify([{ ...JOURNEY, steps: [{ name: "s", folder: "f", checks: [{ name: "c", pass: "yes", detail: "" }] }] }])), /feature\.json check: pass must be a boolean/);
});

await test("a formal result.json reads back unchanged, with and without its optional members", () => {
  assertRoundTrip(FORMAL);
  const minimal: FormalResult = { name: "lifecycle", exitCode: null, violated: ["A"], folder: "f" };
  assertRoundTrip(minimal);
  assertRoundTrip({ ...minimal, base: null });
});

await test("a formal result.json with a wrong-shaped member is refused, naming the member", () => {
  assert.throws(() => parseFormalResult(JSON.stringify({ ...FORMAL, violated: "A" })), /formal result: violated must be a list of strings/);
  assert.throws(() => parseFormalResult(JSON.stringify({ ...FORMAL, exitCode: "0" })), /formal result: exitCode must be a number/);
  assert.throws(() => parseFormalResult(JSON.stringify({ ...FORMAL, behaviour: { method: "tlc" } })), /formal result behaviour: changed must be a boolean/);
});
