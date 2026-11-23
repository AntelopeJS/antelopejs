#!/usr/bin/env node
/**
 * Model-checks BuildStart.tla with TLC through the shared runner of
 * @antelopejs/tooling-configs, once for each configuration in `RUNS`.
 *
 * Every INVARIANT of a configuration must hold, except the findings of its
 * run, which must break with a shortest counterexample of exactly the
 * recorded number of states. Exits 0 when TLC agrees, 1 when a rule changed,
 * and 2 when TLC could not run.
 *
 * @packageDocumentation
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpec } from "@antelopejs/tooling-configs/formal";

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Each configuration with the rules it breaks and the states in TLC's shortest
 * counterexample of each. The first describes the code on main, the others the
 * code before the fix of #497, before the fix of #501, and before both.
 *
 * @type {{ config: string, findings: Record<string, number> }[]}
 */
const RUNS = [
  { config: "BuildStart", findings: {} },
  { config: "BuildStartNoReread", findings: { StartNeverFailsOnAValidBuild: 13 } },
  { config: "BuildStartNonAtomicWrite", findings: { StartNeverFailsOnAValidBuild: 4 } },
  { config: "BuildStartBefore497", findings: { StartNeverFailsOnAValidBuild: 4 } },
];

for (const { config, findings } of RUNS) {
  await checkSpec({ dir, spec: "BuildStart", config, findings });
}
