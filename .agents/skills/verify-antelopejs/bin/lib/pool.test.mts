import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultJobs, MAX_JOBS, runLimited } from "./pool.mts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await test("runLimited never runs more tasks than the limit and returns results in task order", async () => {
  let running = 0;
  let peak = 0;
  const tasks = Array.from({ length: 7 }, (_, index) => async () => {
    running += 1;
    peak = Math.max(peak, running);
    await sleep(5 + (index % 3) * 4);
    running -= 1;
    return index;
  });
  const results = await Promise.all(runLimited(tasks, 3));
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(peak, 3);
});

await test("runLimited keeps starting tasks after one fails", async () => {
  const outcomes = await Promise.allSettled(
    runLimited(
      [
        () => Promise.reject(new Error("first fails")),
        () => Promise.resolve("second"),
        () => Promise.resolve("third"),
      ],
      1,
    ),
  );
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    ["rejected", "fulfilled", "fulfilled"],
  );
});

await test("defaultJobs takes a quarter of the cores, between 2 and the maximum", () => {
  assert.equal(defaultJobs(16), 4);
  assert.equal(defaultJobs(4), 2);
  assert.equal(defaultJobs(1), 2);
  assert.equal(defaultJobs(1024), MAX_JOBS);
});
