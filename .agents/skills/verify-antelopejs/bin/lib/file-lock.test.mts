import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { reclaimLock, withLock } from "./file-lock.mts";

const LOCK_MODULE = pathToFileURL(path.join(import.meta.dirname, "file-lock.mts")).href;
const PROCESSES = 6;
const TRIALS = 8;

const HOLDER = `
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { withLock } from ${JSON.stringify(LOCK_MODULE)};
const [lock, inside, violations, ready, go, index] = process.argv.slice(1);
writeFileSync(ready + "." + index, "");
while (!existsSync(go)) {}
await withLock(lock, async () => {
  try {
    mkdirSync(inside);
  } catch {
    appendFileSync(violations, "x");
  }
  await new Promise((resolve) => setTimeout(resolve, 40));
  rmSync(inside, { recursive: true, force: true });
}, { pollMs: 5 });
`;

function inFolder(check: (folder: string) => void | Promise<void>): Promise<void> {
  const folder = mkdtempSync(path.join(tmpdir(), "verify-file-lock-"));
  return Promise.resolve(check(folder)).finally(() => rmSync(folder, { recursive: true, force: true }));
}

function deadPid(): number {
  const finished = spawnSync(process.execPath, ["-e", ""]);
  assert.ok(finished.pid > 0);
  return finished.pid;
}

function exited(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve) => child.once("exit", resolve));
}

function allExist(files: string[]): boolean {
  return files.every((file) => existsSync(file));
}

async function holdersInside(folder: string): Promise<number> {
  const lock = path.join(folder, "lock");
  const violations = path.join(folder, "violations");
  const ready = Array.from({ length: PROCESSES }, (_, index) => path.join(folder, `ready.${index}`));
  const go = path.join(folder, "go");
  writeFileSync(lock, String(deadPid()));
  writeFileSync(violations, "");
  const finished = ready.map((_, index) =>
    exited(spawn(process.execPath, ["--input-type=module", "-e", HOLDER, lock, path.join(folder, "inside"), violations, path.join(folder, "ready"), go, String(index)], { stdio: "inherit" })),
  );
  while (!allExist(ready)) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  writeFileSync(go, "");
  assert.deepEqual(await Promise.all(finished), Array(PROCESSES).fill(0));
  return statSync(violations).size;
}

await test("a waiter that saw a dead owner leaves the lock alone once a live process holds it", async () => {
  await inFolder((folder) => {
    const lock = path.join(folder, "lock");
    const dead = deadPid();
    writeFileSync(lock, String(process.pid));
    assert.equal(reclaimLock(lock, dead), false);
    assert.equal(existsSync(lock), true);
    assert.equal(existsSync(`${lock}.reclaim-${dead}`), false);
  });
});

await test("a waiter removes the lock of a dead owner and leaves no claim behind", async () => {
  await inFolder((folder) => {
    const lock = path.join(folder, "lock");
    const dead = deadPid();
    writeFileSync(lock, String(dead));
    assert.equal(reclaimLock(lock, dead), true);
    assert.equal(existsSync(lock), false);
    assert.equal(existsSync(`${lock}.reclaim-${dead}`), false);
  });
});

await test("only one waiter at a time reclaims the lock of a dead owner", async () => {
  await inFolder((folder) => {
    const lock = path.join(folder, "lock");
    const dead = deadPid();
    writeFileSync(lock, String(dead));
    writeFileSync(`${lock}.reclaim-${dead}`, String(dead));
    assert.equal(reclaimLock(lock, dead), false);
    assert.equal(existsSync(lock), true);
  });
});

await test("withLock does not take a lock whose owner is alive and gives up after the wait", async () => {
  await inFolder(async (folder) => {
    const lock = path.join(folder, "lock");
    writeFileSync(lock, String(process.pid));
    let ran = false;
    await assert.rejects(
      withLock(
        lock,
        async () => {
          ran = true;
        },
        { waitMs: 30, pollMs: 5 },
      ),
      /held .* for 30 ms/,
    );
    assert.equal(ran, false);
    assert.equal(existsSync(lock), true);
  });
});

await test("withLock releases the lock when its work throws and leaves no file behind", async () => {
  await inFolder(async (folder) => {
    const lock = path.join(folder, "lock");
    await assert.rejects(
      withLock(lock, async () => {
        throw new Error("work failed");
      }),
      /work failed/,
    );
    assert.equal(existsSync(lock), false);
    assert.equal(existsSync(`${lock}.${process.pid}.pending`), false);
  });
});

await test("concurrent processes never hold a dead owner's lock at the same time", async () => {
  const violations: number[] = [];
  for (let trial = 0; trial < TRIALS; trial += 1) {
    await inFolder(async (folder) => {
      violations.push(await holdersInside(folder));
    });
  }
  assert.deepEqual(violations, Array(TRIALS).fill(0));
});
