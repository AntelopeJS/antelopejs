import { Logging } from "@antelopejs/interface-core/logging";
import { expect } from "chai";
import path from "node:path";
import * as sinon from "sinon";

import { type CacheKeep, ModuleCache } from "../../src/core/modules";
import {
  hasEntryFolder,
  inLeaseFolder,
  leaseNames,
  manifestKeys,
  RefusingFileSystem,
  seedCache,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir } from "../helpers/temp";

const KEEP_NOTHING: CacheKeep = () => false;

const REFUSALS = [
  { code: "EACCES", level: "Debug", reason: "a read-only cache" },
  {
    code: "ENOENT",
    level: "Debug",
    reason: "a read-only mount without a lease folder",
  },
  { code: "ENOSPC", level: "Warn", reason: "a full disk" },
] as const;

/** The messages logged at `level` that mention a lease and `code`. */
function leaseMessages(stub: sinon.SinonStub, code: string): string[] {
  return stub.args
    .map(([message]) => String(message))
    .filter((message) => message.includes("lease") && message.includes(code));
}

/** The messages logged on `stub` that say the prune removes nothing. */
function skippedPruneMessages(stub: sinon.SinonStub): string[] {
  return stub.args
    .map(([message]) => String(message))
    .filter((message) => message.includes("not removing unused modules"));
}

describe("ModuleCache when the file system refuses the lease", () => {
  let root: string;
  let cachePath: string;

  beforeEach(() => {
    root = makeTempDir("ajs-cache-lease-refusals-");
    cachePath = path.join(root, "cache");
    seedCache(cachePath, ["a@1.0.0", "b@1.0.0"]);
  });

  afterEach(() => {
    sinon.restore();
    cleanupTempDir(root);
  });

  for (const { code, level, reason } of REFUSALS) {
    it(`resolves the folders it claims on ${reason} (${code}), with no lease, and logs the refusal once at ${level}`, async () => {
      const logged = {
        Debug: sinon.stub(Logging.Channel.prototype, "Debug"),
        Warn: sinon.stub(Logging.Channel.prototype, "Warn"),
      };
      const fs = new RefusingFileSystem(inLeaseFolder(cachePath), code);
      const cache = new ModuleCache(cachePath, fs);

      const folder = await cache.getFolder("a@1.0.0", true, true);
      await cache.claimFolder(path.join(cachePath, "b@1.0.0"));

      expect(folder).to.equal(path.join(cachePath, "a@1.0.0"));
      expect(leaseNames(cachePath)).to.deep.equal([]);
      expect(leaseMessages(logged[level], code)).to.have.length(1);
      const other = level === "Warn" ? logged.Debug : logged.Warn;
      expect(leaseMessages(other, code)).to.deep.equal([]);
    });

    it(`does not prune from a run whose lease ${reason} refused (${code}), and says so at ${level} too`, async () => {
      const logged = {
        Debug: sinon.stub(Logging.Channel.prototype, "Debug"),
        Warn: sinon.stub(Logging.Channel.prototype, "Warn"),
      };
      const fs = new RefusingFileSystem(inLeaseFolder(cachePath), code);
      const run = new ModuleCache(cachePath, fs);
      await run.getFolder("a@1.0.0", true, true);

      await run.prune(async () => KEEP_NOTHING);

      expect(hasEntryFolder(cachePath, "a@1.0.0")).to.equal(true);
      expect(hasEntryFolder(cachePath, "b@1.0.0")).to.equal(true);
      expect(manifestKeys(cachePath)).to.deep.equal(["a@1.0.0", "b@1.0.0"]);
      const other = level === "Warn" ? logged.Debug : logged.Warn;
      expect(skippedPruneMessages(logged[level])).to.have.length(1);
      expect(skippedPruneMessages(other)).to.deep.equal([]);
    });
  }
});
