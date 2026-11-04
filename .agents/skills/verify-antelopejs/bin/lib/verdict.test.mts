import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Json } from "./json.mts";
import { type Judgement, readJudgement } from "./verdict.mts";

const ROW = { kind: "data", location: "src/x.ts", irreversible: "drops rows", containment: "journey", containmentJourney: "j" };
const MINIMAL = { verifier: "v", doors: { none: "nothing" } };

function readText(text: string): Judgement {
  const folder = mkdtempSync(path.join(tmpdir(), "verify-ajs-judgement-"));
  try {
    const file = path.join(folder, "judgement.json");
    writeFileSync(file, text);
    return readJudgement(file);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function read(document: Json): Judgement {
  return readText(JSON.stringify(document));
}

function refusalText(text: string): string {
  try {
    readText(text);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

function refusal(document: Json): string {
  return refusalText(JSON.stringify(document));
}

await test("a document with only the required members reads every optional member as empty", () => {
  assert.deepEqual(read(MINIMAL), {
    notVerified: [],
    attention: [],
    docs: [],
    doorsNone: "nothing",
    verifier: "v",
    doors: [],
    falsePositives: [],
  });
});

await test("a null member reads exactly like an absent one", () => {
  const empty = read(MINIMAL);
  assert.deepEqual(read({ ...MINIMAL, notVerified: null }), empty);
  assert.deepEqual(read({ ...MINIMAL, attention: null }), empty);
  assert.deepEqual(read({ ...MINIMAL, docs: null }), empty);
  assert.deepEqual(read({ verifier: "v", doors: { none: "nothing", rows: null } }), empty);
  assert.deepEqual(read({ verifier: "v", doors: { none: "nothing", falsePositives: null } }), empty);
});

await test("a null doors.none lets the rows stand alone", () => {
  const judgement = read({ verifier: "v", doors: { none: null, rows: [ROW] } });
  assert.equal(judgement.doorsNone, null);
  assert.deepEqual(judgement.doors, [ROW]);
});

await test("a null note or containmentJourney reads as the empty text", () => {
  assert.deepEqual(read({ ...MINIMAL, docs: [{ page: "p", matches: true, note: null }] }).docs, [{ page: "p", matches: true, note: "" }]);
  assert.equal(read({ verifier: "v", doors: { rows: [{ ...ROW, containmentJourney: null }] } }).doors[0]?.containmentJourney, "");
});

await test("a number or a boolean where a text is read prints as it did before", () => {
  const rows = read({ verifier: "v", doors: { rows: [{ ...ROW, irreversible: true, location: 7 }] } }).doors;
  assert.equal(rows[0]?.irreversible, "true");
  assert.equal(rows[0]?.location, "7");
  assert.deepEqual(read({ ...MINIMAL, notVerified: [1, "two", false] }).notVerified, ["1", "two", "false"]);
  assert.deepEqual(read({ ...MINIMAL, docs: [{ page: "p", matches: false, note: 5 }] }).docs, [{ page: "p", matches: false, note: "5" }]);
  assert.equal(read({ verifier: "v", doors: { none: "n", falsePositives: [{ kind: "data", location: 3, reason: "r" }] } }).falsePositives[0]?.location, "3");
});

await test("a 0 or false member that was only tested for truthiness reads as missing or empty", () => {
  assert.match(refusal({ verifier: "v", doors: { rows: [{ ...ROW, location: 0 }] } }), /doors\.rows\[0\] needs kind, location, irreversible and containment/);
  assert.match(refusal({ verifier: "v", doors: { rows: [{ ...ROW, containment: false }] } }), /doors\.rows\[0\] needs/);
  assert.equal(read({ verifier: "v", doors: { rows: [{ ...ROW, containmentJourney: 0 }] } }).doors[0]?.containmentJourney, "");
  assert.equal(read({ ...MINIMAL, docs: [{ page: "p", matches: true, note: false }] }).docs[0]?.note, "");
});

await test("a verifier, a doors.none or a reason that is not a string is refused as it was before", () => {
  assert.match(refusal({ verifier: 5, doors: { none: "n" } }), /verifier must be a string/);
  assert.match(refusal({ verifier: "v", doors: { none: 5 } }), /doors\.none must be a string/);
  assert.match(refusal({ verifier: "v", doors: { none: "n", falsePositives: [{ kind: "data", location: "f", reason: 5 }] } }), /reason must be a string/);
});

await test("a row or false positive missing a required member is refused", () => {
  assert.match(refusal({ verifier: "v", doors: { rows: [{ kind: "data", location: "src/x.ts", irreversible: "drops rows" }] } }), /doors\.rows\[0\] needs kind, location, irreversible and containment/);
  assert.match(refusal({ verifier: "v", doors: { none: "n", falsePositives: [{ kind: "data", location: "f", reason: "  " }] } }), /doors\.falsePositives\[0\] needs location and reason/);
});

await test("an unknown door kind is refused", () => {
  assert.match(refusal({ verifier: "v", doors: { rows: [{ ...ROW, kind: "nope" }] } }), /doors\.rows\[0\]\.kind is "nope"/);
});

await test("a document without a doors section or a verifier is void", () => {
  assert.match(refusal({ verifier: "v" }), /doors needs `none`/);
  assert.match(refusal({ doors: { none: "n" } }), /verifier must say who judged this run/);
  assert.match(refusal({ verifier: "  ", doors: { none: "n" } }), /verifier must say who judged this run/);
});

await test("a member that is not the shape it is read as is refused", () => {
  assert.match(refusal({ ...MINIMAL, notVerified: "oops" }), /notVerified must be an array/);
  assert.match(refusal({ ...MINIMAL, attention: { reason: "x" } }), /attention must be an array/);
  assert.match(refusal({ ...MINIMAL, notVerified: [{ a: 1 }] }), /notVerified\[0\] must be a string/);
  assert.match(refusal({ verifier: "v", doors: { rows: [{ ...ROW, location: { a: 1 } }] } }), /doors\.rows\[0\]\.location must be a string/);
  assert.match(refusal({ ...MINIMAL, docs: ["p"] }), /docs\[0\] needs page/);
});

await test("a document that is not JSON, or whose own __proto__ key stands in for doors, is refused", () => {
  assert.notEqual(refusalText(""), "");
  assert.match(refusalText('{"verifier":"v","__proto__":{"doors":{"none":"inherited"}}}'), /doors needs `none`/);
});
