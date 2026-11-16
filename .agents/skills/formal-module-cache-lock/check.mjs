#!/usr/bin/env node
/**
 * Model-checks CacheLock.tla with TLC through the shared runner of
 * @antelopejs/tooling-configs, once for each configuration in `RUNS`.
 *
 * Every INVARIANT of a configuration must hold, except the findings of its
 * run, which must break with a shortest counterexample of exactly the
 * recorded number of states. Exits 0 when TLC agrees, 1 when a rule changed,
 * and 2 when TLC could not run.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpec } from "@antelopejs/tooling-configs/formal";

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Each configuration with the rules it breaks and the states in TLC's shortest
 * counterexample of each. The first five describe the code on main, the last
 * four the code before the fixes of #499 and #503, #500, #504 and all three.
 *
 * @type {{ config: string, findings: Record<string, number> }[]}
 */
const RUNS = [
  {
    config: "CacheLock",
    findings: { SingleWriter: 19, NoCleanupOfLiveOwner: 19, NoCleanupAfterMiss: 18, NoLiveTakeover: 20, NoForeignRelease: 20 },
  },
  {
    config: "CacheLockCrashOnly",
    findings: { SingleWriter: 27, NoCleanupOfLiveOwner: 27, NoCleanupAfterMiss: 26, NoLiveTakeover: 20, NoForeignRelease: 27 },
  },
  { config: "CacheLockSerialRemoval", findings: {} },
  { config: "CacheLockHolderStall", findings: {} },
  {
    config: "CacheLockCreatorStall",
    findings: { SingleWriter: 18, NoCleanupAfterMiss: 16, NoForeignRelease: 19 },
  },
  { config: "CacheLockBefore499", findings: { SingleWriter: 19 } },
  {
    config: "CacheLockBefore500",
    findings: { SingleWriter: 16, NoCleanupOfLiveOwner: 15, NoCleanupOfLiveFolder: 14, NoCleanupAfterMiss: 14, NoForeignRelease: 17 },
  },
  {
    config: "CacheLockBefore504",
    findings: { SingleWriter: 16, NoCleanupOfLiveFolder: 14, NoCleanupAfterMiss: 14, NoForeignRelease: 17 },
  },
  {
    config: "CacheLockBefore494",
    findings: { SingleWriter: 16, NoCleanupOfLiveOwner: 15, NoCleanupOfLiveFolder: 14, NoCleanupAfterMiss: 14, NoForeignRelease: 17 },
  },
];

for (const { config, findings } of RUNS) {
  await checkSpec({ dir, spec: "CacheLock", config, findings });
}
