import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { copyProject, settleOnce } from "./shared-project.mts";

function makeSource(root: string): string {
  const source = path.join(root, "source", "app");
  mkdirSync(path.join(source, "node_modules", ".pnpm", "typescript@5", "node_modules", "typescript"), { recursive: true });
  mkdirSync(path.join(source, "node_modules", ".bin"), { recursive: true });
  mkdirSync(path.join(source, "dist"), { recursive: true });
  writeFileSync(path.join(source, "node_modules", ".pnpm", "typescript@5", "node_modules", "typescript", "tsc.js"), "tsc\n");
  symlinkSync(".pnpm/typescript@5/node_modules/typescript", path.join(source, "node_modules", "typescript"));
  writeFileSync(path.join(source, "node_modules", ".bin", "tsc"), `#!/bin/sh\nexport NODE_PATH="${source}/node_modules/.pnpm/typescript@5/node_modules"\nprintenv NODE_PATH\n`, { mode: 0o755 });
  writeFileSync(path.join(source, "dist", "index.js"), "built\n");
  utimesSync(path.join(source, "dist", "index.js"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
  return source;
}

function withCopy(check: (source: string, target: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), "verify-copy-project-"));
  try {
    const source = makeSource(root);
    const target = path.join(root, "work", "app");
    copyProject(source, target);
    check(source, target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await test("a copied project keeps its pnpm links relative, so it resolves without the source", () => {
  withCopy((source, target) => {
    assert.equal(readlinkSync(path.join(target, "node_modules", "typescript")), ".pnpm/typescript@5/node_modules/typescript");
    rmSync(source, { recursive: true, force: true });
    assert.equal(existsSync(realpathSync(path.join(target, "node_modules", "typescript", "tsc.js"))), true);
  });
});

await test("a copied project's bin shims point at the copy, not at the source", () => {
  withCopy((source, target) => {
    const nodePath = execFileSync(path.join(target, "node_modules", ".bin", "tsc"), { encoding: "utf8" }).trim();
    assert.equal(nodePath, `${target}/node_modules/.pnpm/typescript@5/node_modules`);
    assert.equal(statSync(path.join(target, "node_modules", ".bin", "tsc")).mode & 0o111, 0o111);
  });
});

await test("a copied project keeps file times, so a built dist stays as old as it was", () => {
  withCopy((source, target) => {
    assert.equal(statSync(path.join(target, "dist", "index.js")).mtimeMs, statSync(path.join(source, "dist", "index.js")).mtimeMs);
  });
});

async function inRunDir(check: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-settle-once-"));
  try {
    await check(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Attempts {
  run: () => Promise<{ status: "PASS" | "FAIL" }>;
  calls: () => number;
}

function attempts(...statuses: Array<"PASS" | "FAIL" | Error>): Attempts {
  let calls = 0;
  return {
    run: async () => {
      const next = statuses[Math.min(calls, statuses.length - 1)];
      calls += 1;
      if (next instanceof Error) {
        throw next;
      }
      return { status: next };
    },
    calls: () => calls,
  };
}

await test("a failed shared init stays failed: a later caller throws without running it again, naming the kept evidence", async () => {
  await inRunDir(async (dir) => {
    const init = attempts("FAIL", "PASS");
    await assert.rejects(settleOnce(dir, init.run), /see evidence\/shared\/project-init\/result\.json/);
    await assert.rejects(settleOnce(dir, init.run), /stays failed for this run, see evidence\/shared\/project-init\/result\.json/);
    assert.equal(init.calls(), 1);
    assert.equal(existsSync(path.join(dir, "shared-project.failed")), true);
    assert.equal(existsSync(path.join(dir, "shared-project.ready")), false);
  });
});

await test("a passing shared init runs once, however many callers ask at the same time", async () => {
  await inRunDir(async (dir) => {
    const init = attempts("PASS");
    await Promise.all([settleOnce(dir, init.run), settleOnce(dir, init.run), settleOnce(dir, init.run)]);
    await settleOnce(dir, init.run);
    assert.equal(init.calls(), 1);
    assert.equal(existsSync(path.join(dir, "shared-project.ready")), true);
  });
});

await test("a shared init that crashed leaves no verdict, so the next caller runs it again", async () => {
  await inRunDir(async (dir) => {
    const init = attempts(new Error("interrupted"), "PASS");
    await assert.rejects(settleOnce(dir, init.run), /interrupted/);
    await settleOnce(dir, init.run);
    assert.equal(init.calls(), 2);
    assert.equal(existsSync(path.join(dir, "shared-project.failed")), false);
  });
});
