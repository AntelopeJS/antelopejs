import type {
  ModuleSourceGit,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { expect } from "chai";

import {
  DownloaderRegistry,
  registerGitDownloader,
  registerPackageDownloader,
} from "../../../src/core/downloaders";
import {
  downloadLockOf,
  ModuleCache,
  ModuleLockStore,
} from "../../../src/core/modules";
import { thisProcess } from "../../helpers/cache-leases";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

const REMOTE = "https://github.com/org/repo.git";
const REPO = REMOTE.replace(/[^a-zA-Z0-9_]/g, "_");
const PKG = "pkg";
const ENTRY = `${PKG}@1.0.0`;
const PACK_FOLDER = "/pack";

/** Rewrites the owner of the download lock of `module`, as a process that took the lock over after 60 s of silence. */
function takeOver(fs: InMemoryFileSystem, module: string): Promise<void> {
  return fs.writeFile(
    `/cache/${downloadLockOf(module)}/owner.json`,
    JSON.stringify({ ...thisProcess(), token: "taken-over", beat: 0 }),
  );
}

/** The message a load threw, or `undefined` once it succeeded. */
function failureOf(load: Promise<unknown>): Promise<string | undefined> {
  return load.then(
    () => undefined,
    (error: unknown) => String(error),
  );
}

/**
 * Loads `REMOTE` into a cache of `fs`, running `takeOverAt` as the command on
 * which another process takes the download lock over. Returns the commands
 * that ran after it and what the load threw.
 */
async function loadGitTakenOverAt(
  fs: InMemoryFileSystem,
  cache: ModuleCache,
  takeOverAt: string,
  source: Omit<ModuleSourceGit, "type" | "remote">,
) {
  const afterTakeover: string[] = [];
  let takenOver = false;
  const exec = async (command: string) => {
    if (takenOver) {
      afterTakeover.push(command);
    }
    if (command === takeOverAt) {
      await takeOver(fs, REPO);
      takenOver = true;
    }
    if (command.startsWith("git clone")) {
      await fs.writeFile(`/cache/${REPO}/package.json`, "{}");
    }
    const stdout = command.startsWith("git rev-") ? "newcommit" : "";
    return { stdout, stderr: "", code: 0 };
  };
  const registry = new DownloaderRegistry();
  registerGitDownloader(registry, { fs, exec });
  const failure = await failureOf(
    registry.load("/project", cache, {
      type: "git",
      remote: REMOTE,
      ...source,
    }),
  );
  return { afterTakeover, failure };
}

async function emptyCache() {
  const fs = new InMemoryFileSystem();
  const cache = new ModuleCache("/cache", fs);
  await cache.load();
  return { fs, cache };
}

describe("A git download whose lock another process takes over at one of its steps", () => {
  it("runs nothing after a clone the takeover happened during, and lists no version", async () => {
    const { fs, cache } = await emptyCache();

    const { afterTakeover, failure } = await loadGitTakenOverAt(
      fs,
      cache,
      `git clone ${REMOTE} ${REPO}`,
      { branch: "develop", installCommand: ["npm install"] },
    );

    expect(failure).to.be.a("string").that.includes("took over");
    expect(afterTakeover).to.deep.equal([]);
    expect(cache.getVersion(REPO)).to.equal(undefined);
  });

  it("runs no reset or install after a checkout of an update the takeover happened during", async () => {
    const { fs, cache } = await emptyCache();
    await fs.writeFile(`/cache/${REPO}/package.json`, "{}");
    await fs.writeFile(`/cache/${REPO}/.git/HEAD`, "ref: refs/heads/main");
    cache.setVersion(REPO, "git:main:oldcommit");

    const { afterTakeover, failure } = await loadGitTakenOverAt(
      fs,
      cache,
      "git checkout develop",
      { branch: "develop", installCommand: ["npm install"] },
    );

    expect(failure).to.be.a("string").that.includes("took over");
    expect(afterTakeover).to.deep.equal([]);
    expect(cache.getVersion(REPO)).to.equal("git:main:oldcommit");
  });

  it("reports the takeover itself when a clone with no branch reads its commit next", async () => {
    const { fs, cache } = await emptyCache();

    const { afterTakeover, failure } = await loadGitTakenOverAt(
      fs,
      cache,
      `git clone ${REMOTE} ${REPO}`,
      { installCommand: ["npm install"] },
    );

    expect(failure)
      .to.be.a("string")
      .that.matches(/^DownloadLockTakenOverError: Another process took over/);
    expect(afterTakeover).to.deep.equal([]);
  });

  it("runs no later install command after one the takeover happened during", async () => {
    const { fs, cache } = await emptyCache();

    const { afterTakeover, failure } = await loadGitTakenOverAt(
      fs,
      cache,
      "first install",
      { branch: "main", installCommand: ["first install", "second install"] },
    );

    expect(failure).to.be.a("string").that.includes("took over");
    expect(afterTakeover).to.deep.equal([]);
  });
});

/**
 * An in-memory file system on which another process takes the download lock
 * of {@link ENTRY} over once a file is copied into its folder, or once its
 * lockfile is written there, as `when` says.
 */
class TakenOverFileSystem extends InMemoryFileSystem {
  private taken = false;

  constructor(private readonly when: "copy" | "lockfile") {
    super();
  }

  override async copyFile(source: string, target: string) {
    await super.copyFile(source, target);
    if (this.when === "copy" && target.startsWith(`/cache/${ENTRY}/`)) {
      await this.takeOverOnce();
    }
  }

  override async writeFile(file: string, data: Buffer | string) {
    await super.writeFile(file, data);
    if (this.when === "lockfile" && file === `/cache/${ENTRY}/pnpm-lock.yaml`) {
      await this.takeOverOnce();
    }
  }

  private async takeOverOnce() {
    if (!this.taken) {
      this.taken = true;
      await takeOver(this, ENTRY);
    }
  }
}

/** Loads {@link ENTRY} with a recorded lockfile from a cache of `fs`, and returns the commands that ran and what the load threw. */
async function loadPackage(fs: TakenOverFileSystem) {
  const cache = new ModuleCache("/cache", fs);
  await cache.load();
  const store = new ModuleLockStore("/project", fs);
  await store.write({
    package: PKG,
    version: "1.0.0",
    lockfile: "pnpm-lock.yaml",
    content: "recorded",
  });
  const commands: string[] = [];
  const exec = async (command: string) => {
    commands.push(command);
    const stdout = command.startsWith("npm pack") ? "pkg-1.0.0.tgz" : "";
    return { stdout, stderr: "", code: 0 };
  };
  const registry = new DownloaderRegistry();
  registerPackageDownloader(registry, {
    fs,
    exec,
    getTemp: async () => PACK_FOLDER,
    extract: async () => {
      await fs.writeFile(
        `${PACK_FOLDER}/package/package.json`,
        JSON.stringify({ name: PKG, version: "1.0.0" }),
      );
    },
    getInstallCommand: async () => "npm install",
    lock: { store, mode: "record" },
  });
  const source: ModuleSourcePackage = {
    type: "package",
    package: PKG,
    version: "1.0.0",
    id: PKG,
  };
  const failure = await failureOf(registry.load("/project", cache, source));
  return { commands, failure };
}

describe("A package download whose lock another process takes over at one of its steps", () => {
  it("replays no lockfile into the folder and runs no install after a copy the takeover happened during", async () => {
    const fs = new TakenOverFileSystem("copy");

    const { commands, failure } = await loadPackage(fs);

    expect(failure).to.be.a("string").that.includes("took over");
    expect(commands).to.not.include("npm install");
    expect(await fs.exists(`/cache/${ENTRY}/pnpm-lock.yaml`)).to.equal(false);
  });

  it("runs no install after a lockfile replay the takeover happened during", async () => {
    const { commands, failure } = await loadPackage(
      new TakenOverFileSystem("lockfile"),
    );

    expect(failure).to.be.a("string").that.includes("took over");
    expect(commands).to.not.include("npm install");
  });
});
