import { expect } from "chai";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../src/core/downloaders";
import { type CacheKeep, ModuleCache } from "../../src/core/modules";
import {
  CHILD_TIMEOUT_MS,
  commitInChild,
  openGate,
} from "../helpers/cache-children";
import {
  hasEntryFolder,
  manifestKeys,
  seedCache,
} from "../helpers/cache-leases";
import { cleanupTempDir, makeTempDir, readText } from "../helpers/temp";

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
