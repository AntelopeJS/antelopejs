import { expect } from "chai";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../src/core/downloaders";
import { NodeFileSystem } from "../../src/core/filesystem";
import { type CacheKeep, ModuleCache } from "../../src/core/modules";
import {
  CHILD_TIMEOUT_MS,
  commitInChild,
  openGate,
} from "../helpers/cache-children";
import {
  deadPid,
  hasEntryFolder,
  manifestKeys,
  seedCache,
  thisProcess,
} from "../helpers/cache-leases";
import {
  cleanupTempDir,
  makeTempDir,
  readText,
  writeJson,
} from "../helpers/temp";

const KEEP_NOTHING: CacheKeep = () => false;
const RUNS = 3;
const COMMITS_PER_RUN = 200;
const DOWNLOADED_INDEX = "module.exports = 'downloaded';\n";

/** A package downloader whose `npm pack` is counted in `packs` and whose download writes `pkg@1.0.0`. */
function countingRegistry(tempRoot: string, packs: string[]) {
  const registry = new DownloaderRegistry();
  registerPackageDownloader(registry, {
    exec: async (command) => {
      if (command.startsWith("npm pack")) {
        packs.push(command);
        return { stdout: "pkg-1.0.0.tgz", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    extract: async (_from, to) => {
      mkdirSync(path.join(to, "package"), { recursive: true });
      writeFileSync(
        path.join(to, "package", "package.json"),
        JSON.stringify({ name: "pkg", version: "1.0.0", main: "index.js" }),
      );
      writeFileSync(path.join(to, "package", "index.js"), DOWNLOADED_INDEX);
    },
    getInstallCommand: async () => "install",
    getTemp: async () => mkdtempSync(path.join(tempRoot, "pack-")),
  });
  return registry;
}

/**
 * The real file system, except that the first time a run writes its new
 * manifest, another process takes the manifest lock over, as after 60 s of
 * silence, and commits `other@1.0.0` before it exits.
 */
class TakenOverFileSystem extends NodeFileSystem {
  private hasTakenOver = false;

  constructor(private readonly cachePath: string) {
    super();
  }

  override async writeFile(file: string, data: Buffer | string) {
    if (
      !this.hasTakenOver &&
      path.basename(file).startsWith("manifest.json.")
    ) {
      this.hasTakenOver = true;
      writeJson(path.join(this.cachePath, ".manifest.lock", "owner.json"), {
        ...thisProcess(),
        pid: deadPid(),
        token: "taken-over",
        beat: 0,
      });
      writeJson(path.join(this.cachePath, "manifest.json"), {
        "other@1.0.0": "1.0.0",
      });
    }
    return super.writeFile(file, data);
  }
}

/**
 * The real file system, except that the first `failures` creations of the
 * manifest lock folder fail with `EPERM`, as on Windows while another
 * process still removes that folder.
 */
class PendingRemovalFileSystem extends NodeFileSystem {
  constructor(
    private readonly lockFolder: string,
    private failures: number,
  ) {
    super();
  }

  override mkdir(file: string, options?: { recursive?: boolean }) {
    if (file === this.lockFolder && this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(
        Object.assign(new Error("EPERM: operation not permitted"), {
          code: "EPERM",
        }),
      );
    }
    return super.mkdir(file, options);
  }
}

describe("ModuleCache manifest saved by several runs", () => {
  let root: string;
  let cachePath: string;

  beforeEach(() => {
    root = makeTempDir("ajs-cache-manifest-saves-");
    cachePath = path.join(root, "cache");
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("keeps every entry that three processes commit at the same time", async function () {
    this.timeout(CHILD_TIMEOUT_MS * 2);
    const goFile = path.join(root, "go");
    const expected: string[] = [];
    const runs = Array.from({ length: RUNS }, (_, run) => {
      const entries = Array.from(
        { length: COMMITS_PER_RUN },
        (_, commit) => `run${run}-${commit}@1.0.0`,
      );
      expected.push(...entries);
      return commitInChild(cachePath, entries, goFile);
    });
    try {
      await Promise.all(runs.map((run) => run.printed("ready")));
      openGate(goFile);
      await Promise.all(runs.map((run) => run.exited));
    } finally {
      openGate(goFile);
      await Promise.all(runs.map((run) => run.exited.catch(() => undefined)));
    }

    expect(manifestKeys(cachePath)).to.deep.equal(expected.sort());
  });

  it("commits once the manifest lock folder that another process was removing is gone", async () => {
    const lockFolder = path.join(cachePath, ".manifest.lock");
    const cache = new ModuleCache(
      cachePath,
      new PendingRemovalFileSystem(lockFolder, 3),
    );
    await cache.load();

    await cache.commitVersion("mine@1.0.0", "1.0.0");

    expect(manifestKeys(cachePath)).to.deep.equal(["mine@1.0.0"]);
  });

  it("fails with EPERM when the manifest lock folder can never be created", async () => {
    const lockFolder = path.join(cachePath, ".manifest.lock");
    const cache = new ModuleCache(
      cachePath,
      new PendingRemovalFileSystem(lockFolder, Number.POSITIVE_INFINITY),
    );
    await cache.load();

    const failure = await cache
      .commitVersion("mine@1.0.0", "1.0.0")
      .catch((error: unknown) => error);

    expect(failure).to.have.property("code", "EPERM");
  });

  it("saves again, renaming nothing, when another process took the manifest lock over during the save", async () => {
    const cache = new ModuleCache(
      cachePath,
      new TakenOverFileSystem(cachePath),
    );
    await cache.load();

    await cache.commitVersion("mine@1.0.0", "1.0.0");

    expect(manifestKeys(cachePath)).to.deep.equal([
      "mine@1.0.0",
      "other@1.0.0",
    ]);
  });

  it("downloads again an entry that a later save listed after a prune moved its folder to the trash", async () => {
    seedCache(cachePath, ["pkg@1.0.0"]);
    const late = new ModuleCache(cachePath);
    await late.load();
    late.setVersion("pkg@1.0.0", "1.0.0");
    await new ModuleCache(cachePath).prune(async () => KEEP_NOTHING);
    await late.save();
    expect(manifestKeys(cachePath)).to.deep.equal(["pkg@1.0.0"]);
    expect(hasEntryFolder(cachePath, "pkg@1.0.0")).to.equal(false);

    const packs: string[] = [];
    const next = new ModuleCache(cachePath);
    await next.load();
    const [loaded] = await countingRegistry(root, packs).load(
      path.join(root, "project"),
      next,
      { type: "package", package: "pkg", version: "1.0.0", id: "pkg" },
    );

    expect(packs).to.have.length(1);
    expect(readText(path.join(loaded.folder, "index.js"))).to.equal(
      DOWNLOADED_INDEX,
    );
    expect(manifestKeys(cachePath)).to.deep.equal(["pkg@1.0.0"]);
  });
});
