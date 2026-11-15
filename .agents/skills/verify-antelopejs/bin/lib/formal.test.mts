import assert from "node:assert/strict";
import { test } from "node:test";

import type { FormalCheck } from "../../verify.config.ts";
import { touchedFormalChecks } from "./formal.mts";

await test("a diff that touches only a check's own files runs the check", () => {
  const check: FormalCheck = {
    name: "formal-add",
    covers: ["src/math.ts"],
    files: [".agents/skills/formal-add/**"],
    command: [],
    violation: null,
  };
  assert.deepEqual(touchedFormalChecks([".agents/skills/formal-add/check.mjs"], [check]), [check]);
  assert.deepEqual(touchedFormalChecks(["src/math.ts"], [check]), [check]);
  assert.deepEqual(touchedFormalChecks(["README.md"], [check]), []);
});
