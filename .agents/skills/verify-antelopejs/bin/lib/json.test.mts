import assert from "node:assert/strict";
import { test } from "node:test";

import { parseJson } from "./json.mts";

const DEEP_LEVELS = 500_000;

await test("parseJson returns what JSON.parse returns for a document nested deeper than the call stack", () => {
  const text = `${"[".repeat(DEEP_LEVELS)}1${"]".repeat(DEEP_LEVELS)}`;
  let depth = 0;
  let value = parseJson(text);
  while (Array.isArray(value)) {
    depth += 1;
    value = value[0];
  }
  assert.equal(depth, DEEP_LEVELS);
  assert.equal(value, 1);
});

await test("parseJson returns a parsed object member by member", () => {
  assert.deepEqual(parseJson('{"a":[1,"x",null,{"b":true}]}'), { a: [1, "x", null, { b: true }] });
});

await test("parseJson returns undefined for text that is not JSON", () => {
  assert.equal(parseJson("not json"), undefined);
});
