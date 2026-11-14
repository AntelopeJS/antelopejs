import { expect } from "chai";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ModuleCache } from "../../src/core/modules";
import {
  deadPid,
  type IdleProcess,
  leaseNameOf,
  leaseNames,
  seedCache,
  startIdleProcess,
  thisProcess,
  writeLease,
  writeLeaseText,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir, readText } from "../helpers/temp";

const ENTRY = "a@1.0.0";
const SEEDED = "module.exports = {};\n";
const DOWNLOADED = "module.exports = 2;\n";

/** The `index.js` in the folder of `ENTRY`, `undefined` once the folder is gone. */
function entryIndex(cachePath: string): string | undefined {
  const file = path.join(cachePath, ENTRY, "index.js");
  return existsSync(file) ? readText(file) : undefined;
}

const REPLACEMENTS = [
  {
    label: "getFolder",
    replace: (cache: ModuleCache) => cache.getFolder(ENTRY, false, true),
    replaced: undefined,
  },
  {
    label: "transfer",
    replace: (cache: ModuleCache, source: string) =>
      cache.transfer(source, ENTRY),
    replaced: DOWNLOADED,
  },
];

describe("ModuleCache replacing a cached folder", () => {
  let root: string;
  let cachePath: string;
  let source: string;
  let other: IdleProcess;

  beforeEach(async () => {
    root = makeTempDir("ajs-cache-replace-");
    cachePath = path.join(root, "cache");
    source = path.join(root, "download");
    mkdirSync(source);
    writeFileSync(path.join(source, "index.js"), DOWNLOADED);
    seedCache(cachePath, [ENTRY]);
    other = await startIdleProcess();
  });

  afterEach(async () => {
    await other.stop();
    cleanupTempDir(root);
  });

  for (const { label, replace, replaced } of REPLACEMENTS) {
    for (const { holder, owner, names } of [
      {
        holder: "the live run of another process",
        owner: () => ({ ...thisProcess(), pid: other.pid }),
        names: () => [String(other.pid), os.hostname()],
      },
      {
        holder: "a run of another machine",
        owner: () => ({ ...thisProcess(), host: "elsewhere", pid: deadPid() }),
        names: () => ["elsewhere"],
      },
    ]) {
      it(`${label} refuses to replace a folder that ${holder} leases, and names that run`, async () => {
        writeLease(cachePath, "holder.json", {
          ...owner(),
          entries: [`${ENTRY}/dist`],
        });

        await assert.rejects(
          replace(new ModuleCache(cachePath), source),
          (error: Error) =>
            [ENTRY, ...names(), "Stop that run", "holder.json", "delete"].every(
              (part) => error.message.includes(part),
            ),
        );

        expect(entryIndex(cachePath)).to.equal(SEEDED);
      });
    }

    for (const { holder, lease } of [
      {
        holder:
          "another cache instance of this process, as after a dev restart",
        lease: async () => {
          await new ModuleCache(cachePath).getFolder(ENTRY, true, true);
        },
      },
      {
        holder: "an unreadable lease",
        lease: async () =>
          writeLeaseText(cachePath, leaseNameOf({ pid: other.pid }), ""),
      },
      {
        holder: "a run of this machine that has exited",
        lease: async () =>
          writeLease(cachePath, "exited.json", {
            ...thisProcess(),
            pid: deadPid(),
            entries: [ENTRY],
          }),
      },
    ]) {
      it(`${label} replaces a folder leased only by ${holder}, deleting no lease`, async () => {
        await lease();

        await replace(new ModuleCache(cachePath), source);

        expect(entryIndex(cachePath)).to.equal(replaced);
        expect(leaseNames(cachePath)).to.have.length(2);
      });
    }
  }
});
