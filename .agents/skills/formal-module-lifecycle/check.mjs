#!/usr/bin/env node
/**
 * Model-checks ModuleLifecycle.tla, and the modules it extends, with TLC.
 *
 * Every INVARIANT in ModuleLifecycle.cfg must hold, except the findings in
 * `FINDINGS`, which must break with a shortest counterexample of exactly the
 * recorded number of states. Exits 0 when TLC agrees, 1 when a rule changed,
 * and 2 when TLC could not run.
 *
 * TLC is the pinned tla2tools.jar, downloaded once into
 * `$XDG_CACHE_HOME/antelopejs-formal` (default `~/.cache/antelopejs-formal`)
 * and checked against its SHA-256. Java comes from `$JAVA`, or `java` on PATH.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TLC_VERSION = "1.7.4";
const TLC_URL = `https://github.com/tlaplus/tlaplus/releases/download/v${TLC_VERSION}/tla2tools.jar`;
const TLC_SHA256 =
  "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const SPEC = "ModuleLifecycle";
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Rules today's code breaks, with the states in TLC's shortest counterexample. */
const FINDINGS = {
  NoOrphanGeneration: 10,
  LaunchReadsCurrentConfig: 21,
  ConfigEditsReachProject: 12,
  NoCrashFromStaleWork: 23,
};

const EXIT_CHANGED = 1;
const EXIT_TOOL = 2;

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`check: ${message}`);
  process.exit(EXIT_TOOL);
}

/** @param {string} file */
function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function ensureJar() {
  const cacheRoot =
    process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  const dir = path.join(cacheRoot, "antelopejs-formal");
  const jar = path.join(dir, `tla2tools-${TLC_VERSION}.jar`);
  if (existsSync(jar) && sha256(jar) === TLC_SHA256) {
    return jar;
  }
  mkdirSync(dir, { recursive: true });
  console.log(`Downloading ${TLC_URL}`);
  const response = await fetch(TLC_URL);
  if (!response.ok) {
    fail(`download failed: HTTP ${response.status}`);
  }
  const partial = `${jar}.${process.pid}.part`;
  writeFileSync(partial, Buffer.from(await response.arrayBuffer()));
  const actual = sha256(partial);
  if (actual !== TLC_SHA256) {
    rmSync(partial, { force: true });
    fail(`tla2tools.jar has SHA-256 ${actual}, expected ${TLC_SHA256}`);
  }
  renameSync(partial, jar);
  return jar;
}

function readConfig() {
  const text = readFileSync(path.join(HERE, `${SPEC}.cfg`), "utf8");
  const constants = [...text.matchAll(/^\s+(\w+)\s*=\s*(\S+)\s*$/gm)].map(
    ([, name, value]) => `  ${name} = ${value}`,
  );
  const invariants = [...text.matchAll(/^INVARIANT\s+(\w+)/gm)].map(
    ([, name]) => name,
  );
  for (const name of Object.keys(FINDINGS)) {
    if (!invariants.includes(name)) {
      fail(`finding ${name} is not an INVARIANT in ${SPEC}.cfg`);
    }
  }
  return { constants, invariants };
}

/**
 * @param {{
 *   java: string,
 *   jar: string,
 *   work: string,
 *   name: string,
 *   constants: string[],
 *   invariants: string[],
 *   workers: string,
 * }} run
 */
function runTlc({ java, jar, work, name, constants, invariants, workers }) {
  const cfg = path.join(work, `${name}.cfg`);
  writeFileSync(
    cfg,
    [
      "SPECIFICATION Spec",
      "CONSTANTS",
      ...constants,
      ...invariants.map((rule) => `INVARIANT ${rule}`),
      "",
    ].join("\n"),
  );
  const result = spawnSync(
    java,
    [
      "-XX:+UseParallelGC",
      "-cp",
      jar,
      "tlc2.TLC",
      "-config",
      cfg,
      "-workers",
      workers,
      "-deadlock",
      "-metadir",
      path.join(work, `states-${name}`),
      `${SPEC}.tla`,
    ],
    { cwd: work, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.error) {
    fail(`cannot run ${java}: ${result.error.message}`);
  }
  const output = `${result.stdout}${result.stderr}`;
  writeFileSync(path.join(work, `${name}.out`), output);
  const violated = output.match(/Invariant (\w+) is violated/)?.[1];
  const distinct = output.match(
    /([\d,]+) distinct states found, 0 states left/,
  )?.[1];
  if (!violated && !output.includes("No error has been found")) {
    fail(
      `TLC did not finish ${name}; output in ${path.join(work, `${name}.out`)}\n${output.slice(-2000)}`,
    );
  }
  const steps = [...output.matchAll(/^State \d+: <(\w+)/gm)].map(
    ([, action]) => action,
  );
  return { violated, distinct, steps };
}

const { constants, invariants } = readConfig();
const java = process.env.JAVA ?? "java";
const jar = await ensureJar();
const work = mkdtempSync(path.join(os.tmpdir(), "formal-module-lifecycle-"));
for (const file of readdirSync(HERE).filter((name) => name.endsWith(".tla"))) {
  copyFileSync(path.join(HERE, file), path.join(work, file));
}

const holding = invariants.filter((rule) => !Object.hasOwn(FINDINGS, rule));
console.log(
  `TLC ${TLC_VERSION} on ${SPEC}.tla with ${constants.map((line) => line.trim()).join(", ")}`,
);
let changed = false;

const held = runTlc({
  java,
  jar,
  work,
  name: "holds",
  constants,
  invariants: holding,
  workers: "auto",
});
if (held.violated) {
  changed = true;
  console.log(`BROKEN ${held.violated}: ${held.steps.join(" -> ")}`);
} else {
  console.log(`holds  ${holding.join(", ")} (${held.distinct} states)`);
}

for (const [rule, expected] of Object.entries(FINDINGS)) {
  const found = runTlc({
    java,
    jar,
    work,
    name: rule,
    constants,
    invariants: [rule],
    workers: "1",
  });
  if (!found.violated) {
    changed = true;
    console.log(
      `HOLDS  ${rule}: the finding is gone (${found.distinct} states)`,
    );
    continue;
  }
  const length = found.steps.length;
  const tag = length === expected ? "finding" : "CHANGED";
  changed ||= length !== expected;
  console.log(
    `${tag} ${rule}: ${length} states (recorded ${expected}): ${found.steps.join(" -> ")}`,
  );
}

if (changed) {
  console.log(`TLC output kept in ${work}`);
  process.exit(EXIT_CHANGED);
}
rmSync(work, { recursive: true, force: true });
console.log("Every rule matches the record in SKILL.md.");
