import assert from "node:assert/strict";
import { test } from "node:test";

import type { Journey, JourneyResult } from "./journey.mts";
import { type FeatureRun, scheduleFeatures } from "./schedule.mts";

function journey(id: string): Journey {
  return { id, title: `title of ${id}`, entryPoint: `entry of ${id}`, run: () => Promise.resolve() };
}

function result(feature: string, id: string, status: "PASS" | "FAIL" = "PASS"): JourneyResult {
  return { feature, journey: id, title: `title of ${id}`, entryPoint: `entry of ${id}`, status, steps: [], error: null, folder: `${feature}/${id}` };
}

function feature(name: string, ids: string[], serial?: string): FeatureRun {
  return { feature: name, journeys: ids.map(journey), serial };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Journeys that finish only when the test says so, and a log of how many ran at once. */
function gated() {
  const gates = new Map<string, (outcome?: JourneyResult) => void>();
  const started: string[] = [];
  const running = new Map<string, number>();
  const peak = new Map<string, number>();
  let all = 0;
  let allPeak = 0;
  const runOne = (name: string, candidate: Journey): Promise<JourneyResult> => {
    const key = `${name}/${candidate.id}`;
    started.push(key);
    running.set(name, (running.get(name) ?? 0) + 1);
    peak.set(name, Math.max(peak.get(name) ?? 0, running.get(name) ?? 0));
    all += 1;
    allPeak = Math.max(allPeak, all);
    return new Promise((resolve) => {
      gates.set(key, (outcome) => {
        running.set(name, (running.get(name) ?? 1) - 1);
        all -= 1;
        resolve(outcome ?? result(name, candidate.id));
      });
    });
  };
  const finish = (key: string, outcome?: JourneyResult): void => {
    const gate = gates.get(key);
    assert.ok(gate, `${key} has not started`);
    gate(outcome);
  };
  return { runOne, finish, started, peak: (name: string) => peak.get(name) ?? 0, allPeak: () => allPeak };
}

await test("feature.json gets each feature's results once, in registered order, when its last journey ends", async () => {
  const world = gated();
  const recorded: { feature: string; ids: string[] }[] = [];
  const outcomes = scheduleFeatures([feature("a", ["a1", "a2", "a3"]), feature("b", ["b1", "b2"])], 8, world.runOne, (name, results) => {
    recorded.push({ feature: name, ids: results.map((entry) => entry.journey) });
  });
  await tick();
  world.finish("a/a3");
  world.finish("a/a2");
  world.finish("b/b2");
  world.finish("b/b1");
  await tick();
  assert.deepEqual(recorded, [{ feature: "b", ids: ["b1", "b2"] }]);
  world.finish("a/a1");
  const settled = await Promise.all(outcomes);
  assert.deepEqual(recorded, [
    { feature: "b", ids: ["b1", "b2"] },
    { feature: "a", ids: ["a1", "a2", "a3"] },
  ]);
  assert.deepEqual(settled.map((outcome) => outcome.feature), ["a", "b"]);
  assert.deepEqual(settled[0].results.map((entry) => entry.journey), ["a1", "a2", "a3"]);
});

await test("journeys of one feature overlap each other and another feature's on the pool", async () => {
  const world = gated();
  const outcomes = scheduleFeatures([feature("a", ["a1", "a2"]), feature("b", ["b1"])], 3, world.runOne, () => undefined);
  await tick();
  assert.deepEqual(world.started, ["a/a1", "a/a2", "b/b1"]);
  assert.equal(world.peak("a"), 2);
  for (const key of world.started) {
    world.finish(key);
  }
  await Promise.all(outcomes);
});

await test("the pool holds back journeys past its limit and starts them as slots free, in the order given", async () => {
  const world = gated();
  const outcomes = scheduleFeatures([feature("a", ["a1", "a2", "a3"]), feature("b", ["b1", "b2"])], 2, world.runOne, () => undefined);
  await tick();
  assert.deepEqual(world.started, ["a/a1", "a/a2"]);
  world.finish("a/a2");
  await tick();
  assert.deepEqual(world.started, ["a/a1", "a/a2", "a/a3"]);
  for (const key of ["a/a1", "a/a3"]) {
    world.finish(key);
    await tick();
  }
  for (const key of ["b/b1", "b/b2"]) {
    await tick();
    world.finish(key);
  }
  await Promise.all(outcomes);
  assert.equal(world.allPeak(), 2);
});

await test("a feature declared serial runs its journeys one at a time in registered order while others overlap it", async () => {
  const world = gated();
  const outcomes = scheduleFeatures([feature("s", ["s1", "s2", "s3"], "s2 reads the project s1 builds"), feature("p", ["p1", "p2"])], 8, world.runOne, () => undefined);
  await tick();
  assert.deepEqual(world.started, ["s/s1", "p/p1", "p/p2"]);
  world.finish("p/p1");
  world.finish("p/p2");
  world.finish("s/s1");
  await tick();
  assert.deepEqual(world.started.filter((key) => key.startsWith("s/")), ["s/s1", "s/s2"]);
  world.finish("s/s2");
  await tick();
  world.finish("s/s3");
  const settled = await Promise.all(outcomes);
  assert.equal(world.peak("s"), 1);
  assert.equal(world.peak("p"), 2);
  assert.deepEqual(settled[0].results.map((entry) => entry.journey), ["s1", "s2", "s3"]);
});

await test("a journey that throws becomes a failed result in its place and the feature is still recorded", async () => {
  const recorded: JourneyResult[][] = [];
  const [outcome] = scheduleFeatures(
    [feature("a", ["a1", "a2", "a3"])],
    2,
    (name, candidate) => (candidate.id === "a2" ? Promise.reject(new Error("could not create the work folder")) : Promise.resolve(result(name, candidate.id))),
    (_, results) => recorded.push(results),
  );
  const settled = await outcome;
  assert.deepEqual(settled.results.map((entry) => [entry.journey, entry.status]), [["a1", "PASS"], ["a2", "FAIL"], ["a3", "PASS"]]);
  assert.match(settled.results[1].error ?? "", /could not create the work folder/);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].length, 3);
});

await test("a feature whose results cannot be recorded reports the error and does not stop the other features", async () => {
  const outcomes = scheduleFeatures(
    [feature("a", ["a1"]), feature("b", ["b1"])],
    2,
    (name, candidate) => Promise.resolve(result(name, candidate.id)),
    (name) => {
      if (name === "a") {
        throw new Error("disk full");
      }
    },
  );
  const settled = await Promise.all(outcomes);
  assert.match(settled[0].error ?? "", /disk full/);
  assert.equal(settled[1].error, undefined);
  assert.deepEqual(settled[1].results.map((entry) => entry.journey), ["b1"]);
});
