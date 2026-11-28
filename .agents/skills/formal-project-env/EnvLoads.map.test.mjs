import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  LaunchEnvLoads,
  loadProjectEnv,
} from "../../../src/core/config/project-env.ts";

const LAUNCHES = [1, 2];

const root = mkdtempSync(path.join(tmpdir(), "env-loads-map-"));

after(() => rmSync(root, { recursive: true }));

let replays = 0;

/**
 * A launch of EnvLoads.tla and the code object that stands for it.
 *
 * @typedef {object} Launch
 * @property {"idle" | "preparing" | "live" | "withdrawn"} st
 * @property {boolean} loaded
 * @property {LaunchEnvLoads | undefined} envLoads
 */

/**
 * One replay: a project of its own, whose `.env` declares a variable no other
 * replay uses, since `process.env` and the loads of `project-env.ts` outlive
 * it.
 *
 * @typedef {object} World
 * @property {string} folder
 * @property {string} name
 * @property {Record<number, Launch>} launches
 * @property {("delete" | number)[]} history
 */

/** @returns {World} */
function world() {
  replays += 1;
  const folder = path.join(root, String(replays));
  const name = `ENV_LOADS_MAP_${replays}`;
  mkdirSync(folder);
  writeFileSync(path.join(folder, ".env"), `${name}=loaded\n`);
  /** @type {Record<number, Launch>} */
  const launches = {};
  for (const L of LAUNCHES) {
    launches[L] = { st: "idle", loaded: false, envLoads: undefined };
  }
  return { folder, name, launches, history: [] };
}

/**
 * The actions of EnvLoads.tla: when each is enabled, and the code it runs.
 *
 * @type {Record<string, { enabled: (w: World, L: number) => boolean, run: (w: World, L: number) => void }>}
 */
const ACTIONS = {
  Start: {
    enabled: (w, L) => w.launches[L].st === "idle",
    run: (w, L) => {
      w.launches[L].st = "preparing";
      w.launches[L].envLoads = new LaunchEnvLoads();
    },
  },
  Load: {
    enabled: (w, L) => w.launches[L].st === "preparing" && !w.launches[L].loaded,
    run: (w, L) => {
      w.launches[L].envLoads?.record(() => loadProjectEnv(w.folder));
      w.launches[L].loaded = true;
      w.history.push(L);
    },
  },
  Complete: {
    enabled: (w, L) => w.launches[L].st === "preparing" && w.launches[L].loaded,
    run: (w, L) => {
      w.launches[L].envLoads?.keep();
      w.launches[L].st = "live";
    },
  },
  Interrupt: {
    enabled: (w, L) => w.launches[L].st === "preparing",
    run: (w, L) => {
      w.launches[L].envLoads?.withdraw();
      w.launches[L].st = "withdrawn";
    },
  },
  UserDelete: {
    enabled: (w) => process.env[w.name] !== undefined,
    run: (w) => {
      delete process.env[w.name];
      w.history.push("delete");
    },
  },
};

/** @typedef {[string, number]} Step */

/**
 * @param {World} w
 * @returns {Step[]}
 */
function enabled(w) {
  /** @type {Step[]} */
  const steps = [];
  for (const [action, { enabled: on }] of Object.entries(ACTIONS)) {
    const launches = action === "UserDelete" ? [0] : LAUNCHES;
    for (const L of launches) {
      if (on(w, L)) steps.push([action, L]);
    }
  }
  return steps;
}

/**
 * The rule of EnvLoads.tla that the state of `w` breaks, if any.
 *
 * @param {World} w
 * @returns {string | undefined}
 */
function broken(w) {
  const surviving = w.history.filter(
    (e) => e === "delete" || w.launches[e].st !== "withdrawn",
  );
  const last = surviving.at(-1);
  const value = process.env[w.name];
  if (last === undefined) {
    return value === undefined ? undefined : "InterruptedLaunchLeavesNoEnv";
  }
  if (last === "delete") {
    return value === undefined ? undefined : "DeletedStaysDeleted";
  }
  return value === "loaded" ? undefined : "LiveLaunchKeepsItsEnv";
}

/**
 * Replays every sequence of actions from `prefix` on, each in a world of its
 * own, and returns each rule broken with the steps that broke it.
 *
 * @param {Step[]} prefix
 * @returns {string[]}
 */
function explore(prefix) {
  const w = world();
  for (const [action, L] of prefix) ACTIONS[action].run(w, L);
  const rule = broken(w);
  if (rule !== undefined) {
    return [`${rule}: ${prefix.map(([a, L]) => (L ? `${a}(${L})` : a)).join(" -> ")}`];
  }
  return enabled(w).flatMap((step) => explore([...prefix, step]));
}

await test("no order of two launches lets a withdrawal unload another launch's .env, revive a deleted variable or leave its own", () => {
  assert.deepEqual(explore([]), []);
  assert.equal(replays, 1161);
});
