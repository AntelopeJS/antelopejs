import type { ModuleSourceGit } from "@antelopejs/interface-core/config";
import { expect } from "chai";

import {
  DownloaderRegistry,
  registerGitDownloader,
} from "../../../src/core/downloaders";
import { ModuleCache } from "../../../src/core/modules";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

const REMOTE = "https://github.com/org/repo.git";
const NAME = REMOTE.replace(/[^a-zA-Z0-9_]/g, "_");
const MANIFEST = JSON.stringify({
  name: "repo",
  version: "1.0.0",
  dependencies: { dep: "^1.0.0", "@scope/other": "^1.0.0" },
});

/**
 * Loads `REMOTE` from a cache that lists its clone, whose `node_modules`
 * holds `installed`, and returns the commands the downloader ran.
 */
async function loadListedClone(installed: string[]): Promise<string[]> {
  const fs = new InMemoryFileSystem();
  const cache = new ModuleCache("/cache", fs);
  await cache.load();
  await fs.writeFile(`/cache/${NAME}/package.json`, MANIFEST);
  await fs.writeFile(`/cache/${NAME}/.git/HEAD`, "ref: refs/heads/main");
  for (const file of installed) {
    await fs.writeFile(`/cache/${NAME}/node_modules/${file}`, "{}");
  }
  cache.setVersion(NAME, "git:main:oldcommit");
  const commands: string[] = [];
  const exec = async (command: string) => {
    commands.push(command);
    if (command.startsWith("git clone")) {
      await fs.writeFile(`/cache/${NAME}/package.json`, MANIFEST);
    }
    const stdout = command.startsWith("git rev-parse") ? "newcommit" : "";
    return { stdout, stderr: "", code: 0 };
  };
  const registry = new DownloaderRegistry();
  registerGitDownloader(registry, { fs, exec });
  const source: ModuleSourceGit = {
    type: "git",
    remote: REMOTE,
    branch: "main",
    installCommand: ["npm install"],
  };

  await registry.load("/project", cache, source);
  return commands;
}

function clonedAgain(commands: string[]): boolean {
  return commands.some((command) => command.startsWith("git clone"));
}

describe("GitDownloader on a listed clone", () => {
  for (const [label, installed] of [
    ["one of them was emptied", ["dep/index.js", "@scope/other/package.json"]],
    ["a scoped one is missing", ["dep/package.json"]],
  ] as const) {
    it(`clones again when node_modules holds the declared dependencies but ${label}`, async () => {
      const commands = await loadListedClone([...installed]);

      expect(clonedAgain(commands)).to.equal(true);
      expect(commands).to.not.include("git fetch");
    });
  }

  it("fetches the clone when node_modules holds a package.json for each declared dependency", async () => {
    const commands = await loadListedClone([
      "dep/package.json",
      "@scope/other/package.json",
    ]);

    expect(commands).to.include("git fetch");
    expect(clonedAgain(commands)).to.equal(false);
  });
});
