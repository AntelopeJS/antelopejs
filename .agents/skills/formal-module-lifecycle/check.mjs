#!/usr/bin/env node
/**
 * Model-checks ModuleLifecycle.tla, and the modules it extends, with TLC
 * through the shared runner of @antelopejs/tooling-configs.
 *
 * Every INVARIANT in ModuleLifecycle.cfg must hold, except the findings in
 * `FINDINGS`, which must break with a shortest counterexample of exactly the
 * recorded number of states. Exits 0 when TLC agrees, 1 when a rule changed,
 * and 2 when TLC could not run.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpec } from "@antelopejs/tooling-configs/formal";

/** Rules today's code breaks, with the states in TLC's shortest counterexample. */
const FINDINGS = {
  NoOrphanGeneration: 10,
  LaunchReadsCurrentConfig: 21,
  ConfigEditsReachProject: 12,
  NoCrashFromStaleWork: 23,
};

await checkSpec({
  dir: path.dirname(fileURLToPath(import.meta.url)),
  spec: "ModuleLifecycle",
  findings: FINDINGS,
});
