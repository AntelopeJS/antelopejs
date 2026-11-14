import type { ModuleSourceGit } from "@antelopejs/interface-core/config";
import { expect } from "chai";

import {
  DownloaderRegistry,
  registerGitDownloader,
} from "../../../src/core/downloaders";
import { ModuleCache } from "../../../src/core/modules";
import {
  leaseNameOf,
  startIdleProcess,
  thisProcess,
} from "../../helpers/cache-leases";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

const REMOTE = "https://github.com/org/repo.git";
const NAME = REMOTE.replace(/[^a-zA-Z0-9_]/g, "_");
const MANIFEST = JSON.stringify({
  name: "repo",
  version: "1.0.0",
  dependencies: { dep: "^1.0.0", "@scope/other": "^1.0.0" },
});
const INSTALL = "npm install";

/**
 * Loads `REMOTE` from a cache that lists its clone at the commit the remote
 * still has, whose `node_modules` holds `installed`, with `installCommand`,
 * and returns the commands the downloader ran.
 */
async function loadListedClone(
  installed: string[],
  installCommand?: string[],
  usedByPid?: number,
): Promise<string[]> {
  const fs = new InMemoryFileSystem();
  const cache = new ModuleCache("/cache", fs);
  await cache.load();
  await fs.writeFile(`/cache/${NAME}/package.json`, MANIFEST);
  await fs.writeFile(`/cache/${NAME}/.git/HEAD`, "ref: refs/heads/main");
  for (const file of installed) {
    await fs.writeFile(`/cache/${NAME}/node_modules/${file}`, "{}");
  }
  cache.setVersion(NAME, "git:main:samecommit");
  if (usedByPid !== undefined) {
    await fs.writeFile(
      `/cache/.leases/${leaseNameOf({ pid: usedByPid })}`,
      JSON.stringify({ ...thisProcess(), pid: usedByPid, entries: [NAME] }),
    );
  }
  const commands: string[] = [];
  const exec = async (command: string) => {
    commands.push(command);
    const stdout = command.startsWith("git rev-") ? "samecommit" : "";
    return { stdout, stderr: "", code: 0 };
  };
  const registry = new DownloaderRegistry();
  registerGitDownloader(registry, { fs, exec });
  const source: ModuleSourceGit = {
    type: "git",
    remote: REMOTE,
    branch: "main",
    installCommand,
  };

  await registry.load("/project", cache, source);
  return commands;
}

function cloned(commands: string[]): boolean {
  return commands.some((command) => command.startsWith("git clone"));
}

describe("GitDownloader on a listed clone at an unchanged commit", () => {
  for (const [label, installed] of [
    ["one of them was emptied", ["dep/index.js", "@scope/other/package.json"]],
    ["a scoped one is missing", ["dep/package.json"]],
  ] as const) {
    it(`fetches it and runs its install again when node_modules holds the declared dependencies but ${label}`, async () => {
      const commands = await loadListedClone([...installed], [INSTALL]);

      expect(commands).to.include("git fetch");
      expect(commands).to.include(INSTALL);
      expect(cloned(commands)).to.equal(false);
    });
  }

  it("fetches it without installing when node_modules holds a package.json for each declared dependency", async () => {
    const commands = await loadListedClone(
      ["dep/package.json", "@scope/other/package.json"],
      [INSTALL],
    );

    expect(commands).to.include("git fetch");
    expect(commands).to.not.include(INSTALL);
    expect(cloned(commands)).to.equal(false);
  });

  it("fetches it, and neither clones nor installs, when the module has no install command to put its dependencies in place", async () => {
    const commands = await loadListedClone([]);

    expect(commands).to.include("git fetch");
    expect(cloned(commands)).to.equal(false);
  });

  it("leaves a clone that another live run uses as it is, without installing", async () => {
    const other = await startIdleProcess();
    try {
      const commands = await loadListedClone([], [INSTALL], other.pid);

      expect(commands).to.not.include(INSTALL);
      expect(commands).to.not.include("git fetch");
      expect(cloned(commands)).to.equal(false);
    } finally {
      await other.stop();
    }
  });
});
