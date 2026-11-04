import assert from "node:assert/strict";
import { test } from "node:test";

import { cause, state } from "./ModuleLifecycle.map.mjs";

/** @import { LifecycleState } from "./ModuleLifecycle.map.mjs" */

const IDLE = { pc: "idle", mod: "a", prev: 0, repl: 0 };

/**
 * @param {Partial<LifecycleState>} overrides
 * @returns {LifecycleState}
 */
function lifecycle(overrides) {
  return {
    exited: false,
    crashed: false,
    sigint: false,
    staleRead: false,
    configOwner: "none",
    launch: 1,
    nextGen: 2,
    lpc: { 1: "running", 2: "none" },
    sd: { 1: "none", 2: "none" },
    state: { 1: "Loaded" },
    gmod: { 1: "a" },
    loaded: { 1: { a: 1 }, 2: { a: 0 } },
    rl: { 1: IDLE, 2: IDLE },
    ...overrides,
  };
}

await test("names a running launch with no reload", () => {
  assert.equal(state(lifecycle({})), "Launch 1 running: no reload");
});

await test("names the module a reload is working on", () => {
  const busy = { pc: "install", mod: "a", prev: 1, repl: 2 };

  assert.equal(
    state(lifecycle({ rl: { 1: IDLE, 2: busy } })),
    "Launch 1 running: reloading a, installing new generation",
  );
});

await test("flags a generation that no launch holds", () => {
  const orphaned = lifecycle({
    state: { 1: "Destroyed" },
    loaded: { 1: { a: 0 }, 2: { a: 0 } },
  });

  assert.equal(
    state(orphaned),
    "Launch 1 running: no reload, a generation outside the project runs",
  );
});

await test("blames the reload that installed the orphan generation", () => {
  const installed = { pc: "idle", mod: "a", prev: 0, repl: 1 };
  const orphaned = lifecycle({
    state: { 1: "Destroyed" },
    loaded: { 1: { a: 0 }, 2: { a: 0 } },
    rl: { 1: installed, 2: IDLE },
  });

  assert.equal(
    cause(orphaned, null, "NoOrphanGeneration"),
    "a reload installed its new generation in a manager the shutdown had already passed",
  );
});

await test("blames a late construction when no reload touched the orphan generation", () => {
  const orphaned = lifecycle({
    state: { 1: "Destroyed" },
    loaded: { 1: { a: 0 }, 2: { a: 0 } },
  });

  assert.equal(
    cause(orphaned, null, "NoOrphanGeneration"),
    "a module constructed after the shutdown had already destroyed and dropped it",
  );
});
