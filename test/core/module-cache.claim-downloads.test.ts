import { expect } from "chai";
import { rmSync } from "node:fs";
import path from "node:path";

import { downloadLockOf, ModuleCache } from "../../src/core/modules";
import {
  type IdleProcess,
  startIdleProcess,
  thisProcess,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir, writeJson } from "../helpers/temp";

const ENTRY = "@scope/pkg@1.0.0";
const PENDING_WINDOW_MS = 200;
const SETTLE_MS = 2000;

function settlesWithin(promise: Promise<unknown>, ms: number) {
  const timeout = new Promise<false>((resolve) =>
    setTimeout(() => resolve(false), ms).unref(),
  );
  return Promise.race([promise.then(() => true), timeout]);
}

describe("A run claiming a cache folder while another process downloads it", () => {
  let root: string;
  let cachePath: string;
  let other: IdleProcess;

  beforeEach(async () => {
    root = makeTempDir("ajs-claim-downloads-");
    cachePath = path.join(root, "cache");
    other = await startIdleProcess();
  });

  afterEach(async () => {
    await other.stop();
    cleanupTempDir(root);
  });

  function holdDownloadLock(): string {
    const lock = path.join(cachePath, downloadLockOf(ENTRY));
    writeJson(path.join(lock, "owner.json"), {
      ...thisProcess(),
      pid: other.pid,
      token: "downloading",
      beat: 0,
    });
    return lock;
  }

  it("waits while another live process holds the download lock of the entry, then returns once it is released", async () => {
    const lock = holdDownloadLock();
    const claimed = new ModuleCache(cachePath).claimFolder(
      path.join(cachePath, ENTRY, "dist"),
    );

    expect(await settlesWithin(claimed, PENDING_WINDOW_MS)).to.equal(false);

    rmSync(lock, { recursive: true });
    expect(await settlesWithin(claimed, SETTLE_MS)).to.equal(true);
  });

  it("does not wait for the download lock this process holds, so a download can claim its own folder", async () => {
    const cache = new ModuleCache(cachePath);

    const loaded = cache.withDownloadLock(ENTRY, () =>
      cache.getFolder(ENTRY, true, true),
    );

    expect(await settlesWithin(loaded, SETTLE_MS)).to.equal(true);
  });
});
