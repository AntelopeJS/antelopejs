import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { clean } from "./lifecycle.mts";
import { forgetProcess, listProcesses, recordProcess, runPaths, type RunState } from "./run.mts";

const WORKERS = 8;
const JOURNEY_MODULE = pathToFileURL(path.join(import.meta.dirname, "journey.mts")).href;
const RUN_MODULE = pathToFileURL(path.join(import.meta.dirname, "run.mts")).href;

const WORKER = `
import { existsSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
const { JourneyContext } = await import(${JSON.stringify(JOURNEY_MODULE)});
const { loadRun } = await import(${JSON.stringify(RUN_MODULE)});
const [dir, feature, sleeper, go, ready] = process.argv.slice(1);
const state = loadRun(dir);
const context = new JourneyContext(state, feature, "journey");
writeFileSync(ready + "/" + feature, "");
while (!existsSync(go)) await sleep(5);
const background = await context.background("sleeper", [], { cli: sleeper });
process.stdout.write(String(background.pid));
process.exit(0);
`;

function makeRun(root: string): RunState {
  const state: RunState = {
    ...runPaths(path.join(root, "run")),
    id: "race",
    manifestUrl: "file:///manifest",
    createdAt: "2026-11-02T00:00:00.000Z",
    headSha: "aaa",
    baseRef: "",
    baseSha: "",
    baseCli: "",
  };
  for (const folder of [state.home, state.work, state.evidence]) {
    mkdirSync(folder, { recursive: true });
  }
  writeFileSync(path.join(state.dir, "run.json"), `${JSON.stringify(state)}\n`);
  return state;
}

function startWorker(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", WORKER, ...args], (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(Number(stdout));
      }
    });
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function allGone(pids: number[]): Promise<boolean> {
  for (let attempt = 0; attempt < 100 && pids.some(alive); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !pids.some(alive);
}

await test("journeys in separate processes that start background processes at once are all recorded, and clean kills every one", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "verify-run-race-"));
  const pids: number[] = [];
  try {
    const state = makeRun(root);
    const sleeper = path.join(root, "sleeper.mjs");
    writeFileSync(sleeper, "setInterval(() => {}, 1000);\n");
    const go = path.join(root, "go");
    const ready = path.join(root, "ready");
    mkdirSync(ready);
    const features = Array.from({ length: WORKERS }, (_, index) => `feature-${index}`);
    const workers = features.map((feature) => startWorker([state.dir, feature, sleeper, go, ready]));
    while (!features.every((feature) => existsSync(path.join(ready, feature)))) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    writeFileSync(go, "");
    pids.push(...(await Promise.all(workers)));

    assert.deepEqual(
      listProcesses(state).map((record) => record.pid).sort((a, b) => a - b),
      [...pids].sort((a, b) => a - b),
    );
    assert.equal(pids.every(alive), true);

    const killed = clean(state);
    assert.equal(killed.filter((line) => line.startsWith("killed ")).length, WORKERS);
    assert.equal(await allGone(pids), true);
    assert.equal(existsSync(path.join(state.dir, "processes")), false);
  } finally {
    for (const pid of pids) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        continue;
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

await test("a process record is gone once forgotten, and the others stay", () => {
  const root = mkdtempSync(path.join(tmpdir(), "verify-run-forget-"));
  try {
    const state = makeRun(root);
    const record = (pid: number) => ({ name: `p${pid}`, pid, port: 3000 + pid, cwd: state.work, startedAt: "2026-11-02T00:00:01.000Z" });
    recordProcess(state, record(7));
    recordProcess(state, record(8));
    forgetProcess(state, 7);
    forgetProcess(state, 7);
    assert.deepEqual(listProcesses(state).map((entry) => entry.pid), [8]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
