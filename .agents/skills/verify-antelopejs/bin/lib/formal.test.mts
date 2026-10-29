import assert from "node:assert/strict";
import { test } from "node:test";

import { type FormalResult, formalGate } from "./formal.mts";

const UNCHANGED = { method: "emit", changed: false, removed: [], added: [] };
const CHANGED = { method: "emit", changed: true, removed: ["a"], added: ["b"] };

function result(extra: Partial<FormalResult>): FormalResult {
  return { name: "formal-test", exitCode: 0, violated: [], folder: "formal/formal-test", ...extra };
}

await test("recorded findings are known, not failing, when the covered behaviour is unchanged", () => {
  const gate = formalGate(result({ violated: ["Rule"], behaviour: UNCHANGED, missing: [] }));
  assert.equal(gate.fails, false);
  assert.match(gate.outcome, /unchanged \(emit\): known findings Rule/);
});

await test("recorded findings fail when the covered behaviour changed", () => {
  assert.equal(formalGate(result({ violated: ["Rule"], behaviour: CHANGED })).fails, true);
});

await test("a rule the base broke that HEAD does not report at all fails instead of counting as fixed", () => {
  const gate = formalGate(result({ behaviour: CHANGED, fixed: [], missing: ["Rule"] }));
  assert.equal(gate.fails, true);
  assert.match(gate.outcome, /absent at HEAD: Rule/);
});

await test("a rule the base broke that HEAD reports passing is fixed", () => {
  const gate = formalGate(result({ behaviour: CHANGED, fixed: ["Rule"], missing: [] }));
  assert.equal(gate.fails, false);
  assert.match(gate.outcome, /fixed: Rule/);
});
